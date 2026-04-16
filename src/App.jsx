import React, { useState, useMemo, useEffect, useCallback } from 'react';
import schematicImg from './Schematic.png';

// Custom Hook for LocalStorage Persistence
const useLocalStorage = (key, initialValue) => {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.log(error);
      return initialValue;
    }
  });

  const setValue = useCallback((value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.log(error);
    }
  }, [key, storedValue]);

  return [storedValue, setValue];
};

const CTR = 10.0;
const R_PULLUP = 5000;
const R_UPPER = 69800;
const R_LED = 2000;

const DEFAULT_PARAMS = {
  phaseView: 'math',
  vin: 110,    // V
  lp: 500,     // uH
  n: 6,        // Np/Ns Ratio
  fsw_max: 65, // kHz
  loadPct: 100,
  vout: 20,    // V
  pout: 150,   // W
  cout: 1690,  // uF
  resr: 18,    // mOhm
  gainTrim: -10,
  td: 2.6,     // us
  gbw: 2.0,    // MHz
  r68: 100000, 
  c71: 100,    // nF
  c70: 68,     // nF
  r65: 1000,   // Ohm
  r64: 3900,   // Ohm
  c73: 10,     // nF
  enableLc: false,
  lf51: 4.0,   
  cout2: 0.1   
};

const App = () => {
  // State for parameters with persistence
  const [params, setParams] = useLocalStorage('flyback-tuner-params-v1', DEFAULT_PARAMS);
  const [showSchematic, setShowSchematic] = useLocalStorage('flyback-show-schematic', true);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Handle input changes
  const handleChange = (name, value) => {
    setParams(prev => ({ ...prev, [name]: value }));
  };

  const resetDefaults = () => {
    if (window.confirm('Are you sure you want to reset all parameters to factory defaults?')) {
        window.localStorage.removeItem('flyback-tuner-params-v1');
        window.location.reload();
    }
  };

  // 1. Calculate Flyback Dynamics & Boundary Analysis Logic
  const dynamics = useMemo(() => {
    const { vin, lp, n, fsw_max, vout, pout, loadPct, r64, r65, c73 } = params;
    
    const safeVin = Number(vin) || 110;
    const safeVout = Number(vout) || 20;
    const safeN = Number(n) || 6;
    const safePout = Number(pout) || 150;
    const safeLoadLevel = Number(loadPct) || 100;
    const safeLp = (Number(lp) || 500) * 1e-6;
    const safeFsw = (Number(fsw_max) || 65) * 1000;
    
    const D = (safeVout * safeN) / (safeVin + safeVout * safeN);
    const Pout_actual = (safeLoadLevel / 100) * safePout;
    const R_load = (safeVout * safeVout) / Math.max(Pout_actual, 1);
    
    const P_crit = (Math.pow(safeVin * D, 2)) / (2 * safeLp * safeFsw);
    const L_crit = (Math.pow(safeVin * D, 2)) / (2 * Math.max(Pout_actual, 1) * safeFsw);
    const L_crit_uh = L_crit * 1e6;
    
    const isCCM = safeLp > L_crit;
    const mode = isCCM ? 'CCM' : (Math.abs(safeLp - L_crit) / L_crit < 0.05 ? 'CRM' : 'DCM');

    const fz_rhp_val = (R_load * Math.pow(1 - D, 2)) / (2 * Math.PI * D * (safeLp / (safeN * safeN)));
    const fz_ff_val = 1 / (2 * Math.PI * (Number(r64) + Number(r65)) * (Number(c73) * 1e-9 + 1e-15));

    return { D, R_load, mode, isCCM, fz_rhp: fz_rhp_val, L_crit: L_crit_uh, P_crit, Pout_actual, fz_ff: fz_ff_val };
  }, [params.vin, params.lp, params.n, params.fsw_max, params.vout, params.pout, params.loadPct, params.r64, params.r65, params.c73]);

  // 2. Transfer Function Calculations
  const calcFreqResponse = useMemo(() => {
    const { D, R_load, isCCM, fz_rhp, fz_ff } = dynamics;
    const { vin, lp, n, cout, resr, gainTrim, td, gbw, r68, c71, c70 } = params;
    
    const freqs = [];
    const magOpen = [];
    const phaseOpen = [];
    const magPlant = [];
    const magComp = [];
    
    const safeVin = Number(vin) || 110;
    const safeN = Number(n) || 6;
    const safeCout = (Number(cout) || 1690) * 1e-6;
    const safeLp = (Number(lp) || 500) * 1e-6;
    
    let G_dc;
    if (isCCM) {
      G_dc = safeVin / (safeN * Math.pow(1 - D, 2));
    } else {
      G_dc = (Number(params.vout) || 20) / Math.max(D, 0.01);
    }
    const Plant_DC_Mag = 20 * Math.log10(Math.max(G_dc, 1e-12));
    
    const fz_esr = 1 / (2 * Math.PI * (Number(resr) * 1e-3) * safeCout);
    const C71_F = Number(c71) * 1e-9;
    const C70_F = Number(c70) * 1e-9;
    const R68_V = Number(r68);
    const fz_comp = 1 / (2 * Math.PI * R68_V * (C71_F + 1e-15));
    const fp_comp = 1 / (2 * Math.PI * R68_V * ((C71_F * C70_F) / (C71_F + C70_F + 1e-15)));
    
    const f_gbw = (gbw || 2) * 1e6;
    
    const f0_plant = (1 - D) / (2 * Math.PI * Math.sqrt((safeLp / (safeN * safeN)) * safeCout));
    const Q_plant = R_load * Math.sqrt(safeCout / (safeLp / (safeN * safeN)));
    const fp_dcm = 2 / (2 * Math.PI * R_load * safeCout); 

    const K_stat = (CTR * R_PULLUP) / (R_UPPER * R_LED * (C71_F + 1e-15));
    const Comp_DC_Mag = 20 * Math.log10(Math.max(K_stat, 1e-12));

    const f_points = 1000;
    for (let i = 0; i < f_points; i++) {
      const f = Math.pow(10, (7 / f_points) * i);
      freqs.push(f);
      
      let P_Mag = Plant_DC_Mag;
      let P_Phase = 0;

      P_Mag += 10 * Math.log10(1 + Math.pow(f / fz_esr, 2));
      P_Phase += Math.atan(f / fz_esr) * (180 / Math.PI);

      if (isCCM) {
        const u = f / f0_plant;
        P_Mag -= 10 * Math.log10(Math.pow(1 - u * u, 2) + Math.pow(u / Math.max(Q_plant, 0.01), 2));
        let dp_phase = Math.atan2(-u / Math.max(Q_plant, 0.01), 1 - u * u) * (180 / Math.PI);
        if (dp_phase > 0) dp_phase -= 360;
        P_Phase += dp_phase;
        P_Mag += 10 * Math.log10(1 + Math.pow(f / fz_rhp, 2));
        P_Phase -= Math.atan(f / fz_rhp) * (180 / Math.PI);
      } else {
        P_Mag -= 10 * Math.log10(1 + Math.pow(f / fp_dcm, 2));
        P_Phase -= Math.atan(f / fp_dcm) * (180 / Math.PI);
      }

      const C_int_Mag = -20 * Math.log10(2 * Math.PI * f);
      const C_int_Phase = -90;
      const C_zero_Mag = 10 * Math.log10(1 + Math.pow(f / fz_comp, 2));
      const C_zero_Phase = Math.atan(f / fz_comp) * (180 / Math.PI);
      const C_pole_Mag = -10 * Math.log10(1 + Math.pow(f / fp_comp, 2));
      const C_pole_Phase = -Math.atan(f / fp_comp) * (180 / Math.PI);
      const C_gbw_Mag = -10 * Math.log10(1 + Math.pow(f / f_gbw, 2));
      const C_gbw_Phase = -Math.atan(f / f_gbw) * (180 / Math.PI);
      
      const FF_Mag = 10 * Math.log10(1 + Math.pow(f / fz_ff, 2));
      const FF_Phase = Math.atan(f / fz_ff) * (180 / Math.PI);

      const Comp_Mag = Comp_DC_Mag + C_int_Mag + C_zero_Mag + C_pole_Mag + C_gbw_Mag + FF_Mag;
      const Comp_Phase = C_int_Phase + C_zero_Phase + C_pole_Phase + C_gbw_Phase + FF_Phase;

      const Delay_Phase = -360 * f * (td * 1e-6);
      
      const totalMag = P_Mag + Comp_Mag + (Number(gainTrim) || 0);
      const totalPhase = P_Phase + Comp_Phase + Delay_Phase;

      magPlant.push(P_Mag + (Number(gainTrim) || 0));
      magComp.push(Comp_Mag);
      magOpen.push(totalMag);
      phaseOpen.push(totalPhase);
    }
    
    return { freqs, magOpen, phaseOpen, magPlant, magComp };
  }, [params, dynamics]);

  // 3. Finding Crossover & Margins
  const margins = useMemo(() => {
    const { freqs, magOpen, phaseOpen } = calcFreqResponse;
    let fc = null, pm = null, gm = null;
    
    for (let i = 0; i < magOpen.length - 1; i++) {
      if (magOpen[i] >= 0 && magOpen[i+1] < 0) {
        const frac = magOpen[i] / (magOpen[i] - magOpen[i+1]);
        fc = freqs[i] + frac * (freqs[i+1] - freqs[i]);
        const pmRaw = phaseOpen[i] + frac * (phaseOpen[i+1] - phaseOpen[i]);
        pm = 180 + pmRaw;
        break;
      }
    }
    
    for (let i = 0; i < phaseOpen.length - 1; i++) {
        if (phaseOpen[i] >= -180 && phaseOpen[i+1] < -180) {
            const frac = (phaseOpen[i] + 180) / (phaseOpen[i] - phaseOpen[i+1]);
            const mag_at_180 = magOpen[i] + frac * (magOpen[i+1] - magOpen[i]);
            gm = -mag_at_180;
            break;
        }
    }

    return { fc, pm, gm };
  }, [calcFreqResponse]);

  // 4. Update Charts
  useEffect(() => {
    const { freqs, magOpen, phaseOpen, magPlant, magComp } = calcFreqResponse;
    const { phaseView } = params;
    const shift = phaseView === 'instrument' ? 180 : 0;
    
    const magData = [
      { x: freqs, y: magPlant, name: 'Flyback Plant', line: { color: '#94a3b8', dash: 'dash', width: 1.5 } },
      { x: freqs, y: magComp, name: 'Compensator', line: { color: '#fbbf24', dash: 'dot', width: 1.5 } },
      { x: freqs, y: magOpen, name: 'Open-Loop', line: { color: '#3b82f6', width: 2.5 } },
      { x: [1, 1e7], y: [0, 0], name: '0dB', line: { color: '#000000', width: 2 } }
    ];
    
    const phaseData = [
      { x: freqs, y: phaseOpen.map(p => p + shift), name: 'Open-Loop', line: { color: '#3b82f6', width: 2.5 } },
      { x: [1, 1e7], y: [shift - 180, shift - 180], name: 'Limit', line: { color: '#ef4444', dash: 'dash', width: 1.5 } }
    ];

    const layoutBase = {
        template: 'plotly_dark',
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        margin: { l: 60, r: 30, t: 30, b: 50 },
        xaxis: { type: 'log', gridcolor: '#1e293b', title: 'Frequency (Hz)' },
        yaxis: { gridcolor: '#1e293b' },
        showlegend: false,
        hovermode: 'x unified',
        hoverlabel: {
            bgcolor: 'rgba(30, 41, 59, 0.95)',
            bordercolor: '#475569',
            font: { family: 'Inter', size: 13, color: '#f8fafc' }
        }
    };

    if (window.Plotly) {
        const config = { responsive: true, displayModeBar: false };
        Plotly.react('c-mag', magData, { ...layoutBase, yaxis: { ...layoutBase.yaxis, range: [-60, 60], dtick: 20, title: 'Magnitude (dB)' } }, config);
        Plotly.react('c-phase', phaseData, { ...layoutBase, yaxis: { ...layoutBase.yaxis, range: shift === 180 ? [-20, 200] : [-200, 20], dtick: 30, title: 'Phase (Deg)' } }, config);

        const magEl = document.getElementById('c-mag');
        const phEl = document.getElementById('c-phase');
        if (magEl && phEl && !magEl._hasHoverSync) {
            magEl._hasHoverSync = true;
            phEl._hasHoverSync = true;
            magEl.on('plotly_hover', d => window.Plotly.Fx.hover('c-phase', { xval: d.points[0].x }));
            magEl.on('plotly_unhover', () => window.Plotly.Fx.unhover('c-phase'));
            phEl.on('plotly_hover', d => window.Plotly.Fx.hover('c-mag', { xval: d.points[0].x }));
            phEl.on('plotly_unhover', () => window.Plotly.Fx.unhover('c-mag'));
        }
    }
  }, [calcFreqResponse, params.phaseView, margins]);

  return (
    <div style={{ display: 'flex', width: '100%' }}>
      <button 
          className="mobile-toggle-btn"
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
      >
          {isSidebarOpen ? 'Hide' : 'Params'}
      </button>

      <div className={`sidebar ${!isSidebarOpen ? 'collapsed' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h2 style={{ fontSize: '1.1em', margin: 0 }}>Flyback Bode Plot Simulator</h2>
            <button 
                onClick={resetDefaults}
                style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '0.75em', fontWeight: 'bold', cursor: 'pointer' }}
            >
                RESET
            </button>
        </div>
        
        <div className="control-group">
            <label className="control-label">Phase Display Mode</label>
            <select 
                className="num-input" 
                style={{ width: '100%', marginTop: '5px', textAlign: 'center', color: '#fff' }}
                value={params.phaseView}
                onChange={(e) => handleChange('phaseView', e.target.value)}
            >
                <option value="math">Math (- Deg)</option>
                <option value="instrument">Instrument (+ Deg)</option>
            </select>
        </div>

        <div className="control-group" style={{ marginTop: '10px' }}>
            <div className="control-header">
                <label className="control-label">顯示電路圖參考</label>
                <input 
                    type="checkbox" 
                    checked={showSchematic} 
                    onChange={(e) => setShowSchematic(e.target.checked)}
                    style={{ accentColor: '#3b82f6', width: '18px', height: '18px' }}
                />
            </div>
        </div>

        <h2 style={{ fontSize: '0.9em', marginTop: '20px', color: '#94a3b8', textTransform: 'uppercase' }}>[POWER STAGE] Parameters</h2>
        <Slider label="Vin 輸入電壓 (V)" name="vin" value={params.vin} min={90} max={400} step={1} onChange={handleChange} />
        <Slider label="Lp 一次側電感 (μH)" name="lp" value={params.lp} min={100} max={1000} step={1} onChange={handleChange} />
        <Slider label="Np/Ns Ratio 圈數比" name="n" value={params.n} min={1} max={20} step={0.1} onChange={handleChange} />
        <Slider label="Fsw_max 最大頻率 (kHz)" name="fsw_max" value={params.fsw_max} min={20} max={150} step={1} onChange={handleChange} />
        <Slider label="Vout 輸出電壓 (V)" name="vout" value={params.vout} min={3.3} max={60} step={0.1} onChange={handleChange} />
        <Slider label="Pout 最大功率 (W)" name="pout" value={params.pout} min={10} max={1000} step={5} onChange={handleChange} />
        <Slider label="負載比例 (%)" name="loadPct" value={params.loadPct} min={1} max={100} step={1} onChange={handleChange} />

        <h2 style={{ fontSize: '0.9em', marginTop: '20px', color: '#94a3b8', textTransform: 'uppercase' }}>Output Filter</h2>
        <Slider label="Cout Cap (µF)" name="cout" value={params.cout} min={100} max={10000} step={10} onChange={handleChange} />
        <Slider label="ESR Res (mΩ)" name="resr" value={params.resr} min={1} max={200} step={1} onChange={handleChange} />

        <h2 style={{ fontSize: '0.9em', marginTop: '20px', color: '#94a3b8', textTransform: 'uppercase' }}>Compensator (AP4310)</h2>
        <Slider label="Loop Gain Trim (dB)" name="gainTrim" value={params.gainTrim} min={-60} max={60} step={1} onChange={handleChange} />
        <Slider label="R72 Resistor (Ω)" name="r68" value={params.r68} min={100} max={1000000} step={100} onChange={handleChange} />
        <Slider label="C75 Zero Cap (nF)" name="c71" value={params.c71} min={0.1} max={1000} step={0.1} onChange={handleChange} />
        <Slider label="C74 Pole Cap (nF)" name="c70" value={params.c70} min={0} max={100} step={0.01} onChange={handleChange} />
        <Slider label="Propagation Delay (μs)" name="td" value={params.td} min={0} max={10} step={0.1} onChange={handleChange} />
        <Slider label="Op-Amp GBW (MHz)" name="gbw" value={params.gbw} min={0.1} max={20} step={0.1} onChange={handleChange} />

        <h2 style={{ fontSize: '0.9em', marginTop: '20px', color: '#94a3b8', textTransform: 'uppercase' }}>Opto & Feed-Forward</h2>
        <Slider label="R61 Bias (Ω)" name="r64" value={params.r64} min={100} max={10000} step={10} onChange={handleChange} />
        <Slider label="R78 FF Res (Ω)" name="r65" value={params.r65} min={100} max={5000} step={1} onChange={handleChange} />
        <Slider label="C77 FF Cap (nF)" name="c73" value={params.c73} min={0} max={100} step={0.1} onChange={handleChange} />

        <div className="hw-tag">Flyback QR/DCM/CCM Engine v1.1</div>
      </div>

      <div className="main-content">
        {showSchematic && (
            <div 
                style={{ 
                    background: '#ffffff', 
                    border: '1px solid #475569', 
                    borderRadius: '12px', 
                    padding: '8px', 
                    marginBottom: '16px',
                    maxHeight: isZoomed ? '800px' : '250px',
                    width: '100%',
                    overflow: 'auto',
                    display: 'flex',
                    justifyContent: 'center',
                    cursor: isZoomed ? 'zoom-out' : 'zoom-in',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    transition: 'max-height 0.35s ease-in-out'
                }}
                onClick={() => setIsZoomed(!isZoomed)}
            >
                <img 
                    src={schematicImg} 
                    alt="Schematic" 
                    style={{ 
                        width: '100%', 
                        height: 'auto',
                        objectFit: 'contain',
                        display: 'block'
                    }}
                />
            </div>
        )}

        <div className="metrics-row">
            <MetricCard label="Operating Mode" value={dynamics.mode} highlight={true} />
            <MetricCard label="Crossover (fc)" value={margins.fc ? (margins.fc/1000).toFixed(2) + " kHz" : "N/A"} />
            <MetricCard label="Phase Margin" value={margins.pm ? margins.pm.toFixed(1) + "°" : "N/A"} />
            <MetricCard label="Gain Margin" value={margins.gm ? margins.gm.toFixed(1) + " dB" : "N/A"} />
            <MetricCard 
                label={dynamics.isCCM ? "RHP Zero (f_rhp)" : "Boundary L_crit"} 
                value={dynamics.isCCM ? (dynamics.fz_rhp/1000).toFixed(1) + " kHz" : (dynamics.L_crit).toFixed(0) + " μH"} 
            />
            <MetricCard label="FF Zero (f_ff)" value={(dynamics.fz_ff/1000).toFixed(1) + " kHz"} />
        </div>

        <div className="dashboard-grid">
            <ChartContainer id="c-mag" title="Flyback Loop Magnitude" yUnit="dB" xUnit="Hz" />
            <ChartContainer id="c-phase" title="Flyback Loop Phase" yUnit="Deg" xUnit="Hz" />
        </div>

        <div className="boundary-analysis-panel">
            <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid #475569', paddingBottom: '8px', fontSize: '1.1em' }}>CCM / DCM 臨界條件分析 (Boundary Analysis)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                <div className="math-column">
                    <p style={{ color: '#94a3b8', fontSize: '0.85em', marginBottom: '10px' }}>【即時公式與結果】</p>
                    <div style={{ background: '#0f172a', padding: '15px', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.95em', borderLeft: '3px solid #3b82f6', lineHeight: '1.8' }}>
                       <div>佔空比： D = (Vout × N) / (Vin + Vout × N) = <strong>{dynamics.D.toFixed(3)}</strong></div>
                       <div>臨界功率： P_crit = (Vin × D)² / (2 × Lp × Fsw) = <strong style={{color: '#f8fafc'}}>{dynamics.P_crit.toFixed(1)} W</strong></div>
                       <div>臨界電感： L_crit = (Vin × D)² / (2 × Pout × Fsw) = <strong style={{color: '#f8fafc'}}>{dynamics.L_crit.toFixed(1)} μH</strong></div>
                    </div>
                </div>
                <div className="decision-column" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'rgba(30, 41, 59, 0.5)', borderRadius: '12px', padding: '10px' }}>
                    <p style={{ color: '#94a3b8', fontSize: '0.85em', marginBottom: '15px', width: '100%', textAlign: 'left' }}>【模式判定對決】</p>
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '1.1em' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 20px' }}>
                            <span>Pout ({dynamics.Pout_actual.toFixed(1)} W)</span>
                            <span style={{ fontWeight: 'bold' }}> {dynamics.Pout_actual > dynamics.P_crit ? '>' : '<'} </span>
                            <span>P_crit ({dynamics.P_crit.toFixed(1)} W)</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 20px' }}>
                            <span>Lp ({params.lp} μH)</span>
                            <span style={{ fontWeight: 'bold' }}> {params.lp > dynamics.L_crit ? '>' : '<'} </span>
                            <span>L_crit ({dynamics.L_crit.toFixed(1)} μH)</span>
                        </div>
                    </div>
                    <div style={{ marginTop: '20px', fontSize: '2em', fontWeight: 'bold', color: dynamics.isCCM ? '#fb923c' : '#34d399', letterSpacing: '2px' }}>
                        [{dynamics.mode} 模式]
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

const Slider = ({ label, name, value, min, max, step, onChange }) => (
  <div className="control-group">
    <div className="control-header">
      <label className="control-label">{label}</label>
      <input 
        type="number" 
        className="num-input" 
        value={value} 
        onChange={(e) => onChange(name, parseFloat(e.target.value) || 0)} 
      />
    </div>
    <input 
      type="range" 
      value={value} 
      min={min} 
      max={max} 
      step={step} 
      onChange={(e) => onChange(name, parseFloat(e.target.value) || 0)} 
    />
  </div>
);

const MetricCard = ({ label, value, highlight }) => (
  <div className="metric-card" style={highlight ? { border: '1px solid #3b82f6', background: 'rgba(59, 130, 246, 0.1)' } : { flex: 1, minWidth: '120px' }}>
    <div className="metric-label">{label}</div>
    <div className="metric-value" style={{ fontSize: '1.2em' }}>{value}</div>
  </div>
);

const ChartContainer = ({ id, title, yUnit, xUnit }) => (
  <div className="chart-container">
    <div className="chart-header">{title}</div>
    <div className="unit-label-y" style={{ position: 'absolute', top: '60px', left: '15px', zIndex: 20, color: '#94a3b8', fontSize: '12px', fontWeight: 700 }}>{yUnit}</div>
    <div className="unit-label-x" style={{ position: 'absolute', bottom: '5px', right: '15px', zIndex: 20, color: '#94a3b8', fontSize: '12px', fontWeight: 700 }}>{xUnit}</div>
    <div id={id} className="chart-div" />
  </div>
);

export default App;
