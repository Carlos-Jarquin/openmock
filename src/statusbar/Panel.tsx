// Status bar controls, shared by the /live floating panel and the studio's Status bar section.
import { useState } from 'react'
import { SB_DEFAULT, SB_LOCK, SB_UNLOCK, sbLockScreen, type SbCfg } from './config'

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between', minHeight: 24 }
const sub: React.CSSProperties = { ...row, paddingLeft: 14 }
const field: React.CSSProperties = { font: 'inherit', width: 84, padding: '2px 5px', border: '1px solid #c7c7cc', borderRadius: 5, background: '#fff' }

function Seg<T extends string | number>({ id, value, opts, onChange }: { id: string; value: T; opts: [T, string][]; onChange: (v: T) => void }) {
  return <span style={{ display: 'inline-flex', background: '#e5e5ea', borderRadius: 6, padding: 1 }}>
    {opts.map(([v, l]) => <button key={String(v)} data-id={`${id}-${v}`} onClick={() => onChange(v)} style={{ font: 'inherit', fontSize: 12, border: 0, borderRadius: 5, padding: '2px 7px', cursor: 'pointer',
      background: v === value ? '#fff' : 'transparent', color: '#1d1d1f', boxShadow: v === value ? '0 1px 2px rgba(0,0,0,0.15)' : 'none' }}>{l}</button>)}
  </span>
}
const Check = ({ id, label, on, set, style }: { id: string; label: string; on: boolean; set: (v: boolean) => void; style?: React.CSSProperties }) =>
  <label style={{ ...row, justifyContent: 'flex-start', ...style }}><input id={id} type="checkbox" checked={on} onChange={e => set(e.target.checked)} /> {label}</label>

/** All status bar controls. Free text (time, carrier) keeps its own draft so a half-typed value does not reset. */
export function StatusBarControls({ sb, onChange, resetKey = 0 }: { sb: SbCfg; onChange: (c: SbCfg) => void; resetKey?: number }) {
  const [timeText, setTimeText] = useState(sb.time ?? '9:41')
  const [carrierText, setCarrierText] = useState(sb.carrier ?? 'ROGERS')
  const [rk, setRk] = useState(resetKey)
  if (rk !== resetKey) { setRk(resetKey); setTimeText('9:41'); setCarrierText('ROGERS') }
  const up = (p: Partial<SbCfg>) => onChange({ ...sb, ...p })
  const timeOk = /^\d{1,2}:\d{2}$/.test(timeText)
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4, font: '13px -apple-system, system-ui, sans-serif', color: '#1d1d1f' }}>
        <div style={row}>Text colour <Seg id="sb-mode" value={sb.mode} onChange={v => up({ mode: v })} opts={[['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light'], ['off', 'Off']]} /></div>
        <Check id="sb-lockscreen" label="Lock screen (carrier, padlock, battery line)" on={sbLockScreen(sb)} set={v => { if (v) setCarrierText(sb.carrier ?? (carrierText || 'ROGERS')); up(v ? { ...SB_LOCK, carrier: sb.carrier ?? (carrierText || 'ROGERS') } : SB_UNLOCK) }} />
        <Check id="sb-carrier-on" label="Show carrier instead of time" on={sb.carrier !== null} set={v => up({ carrier: v ? carrierText || 'ROGERS' : null })} />
        {sb.carrier !== null
          ? <div style={sub}>Carrier <input id="sb-carrier" style={field} value={carrierText} onChange={e => { setCarrierText(e.target.value); up({ carrier: e.target.value }) }} /></div>
          : <>
            <Check id="sb-live" label="Live time" on={sb.time === null} set={v => up({ time: v ? null : timeOk ? timeText : '9:41' })} />
            {sb.time !== null && <div style={sub}>Time <input id="sb-time" style={{ ...field, borderColor: timeOk ? '#c7c7cc' : '#ff3b30' }} value={timeText} placeholder="9:41"
              onChange={e => { setTimeText(e.target.value); if (/^\d{1,2}:\d{2}$/.test(e.target.value)) up({ time: e.target.value }) }} /></div>}
          </>}
        <Check id="sb-dnd" label="Do Not Disturb" on={sb.dnd} set={v => up({ dnd: v })} />
        <Check id="sb-loc" label="Location" on={sb.loc} set={v => up({ loc: v })} />
        {sb.dnd && sb.loc && <div style={{ ...sub, color: '#6e6e73', fontSize: 11 }}>iOS shows only the moon when both are on.</div>}
        <div style={row}>Network <Seg id="sb-net" value={sb.net} onChange={v => up({ net: v })} opts={[['wifi', 'Wi-Fi'], ['lte', 'LTE'], ['5g', '5G'], ['none', 'None']]} /></div>
        {sb.net === 'wifi' && <div style={sub}>Wi-Fi strength <Seg id="sb-wifi" value={sb.wifi} onChange={v => up({ wifi: v })} opts={[[0, '0'], [1, '1'], [2, '2'], [3, '3']]} /></div>}
        <div style={row}>Cell signal <Seg id="sb-sig" value={sb.sig} onChange={v => up({ sig: v })} opts={[[-1, 'None'], [0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4']]} /></div>
        {sb.sig >= 0 && <Check id="sb-dual" label="Dual SIM" on={sb.dual} set={v => up({ dual: v })} style={{ paddingLeft: 14 }} />}
        {sb.sig >= 0 && sb.dual && <div style={sub}>Second signal <Seg id="sb-sig2" value={sb.sig2} onChange={v => up({ sig2: v })} opts={[[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4']]} /></div>}
        <div style={row}>Battery <input id="sb-level" type="range" min={0} max={100} value={sb.level} onChange={e => up({ level: Number(e.target.value) })} style={{ flex: 1 }} /> <span style={{ width: 34, textAlign: 'right' }}>{sb.level}%</span></div>
        <Check id="sb-batteryline" label="Line under battery (lock screen)" on={sb.batteryLine} set={v => up({ batteryLine: v })} style={{ paddingLeft: 14 }} />
        <Check id="sb-percent" label="Show percentage" on={sb.pct} set={v => up({ pct: v })} style={{ paddingLeft: 14 }} />
        <div style={row}>Island <Seg id="sb-island" value={sb.island} onChange={v => up({ island: v })} opts={[['compact', 'Compact'], ['activity', 'Activity']]} /></div>
        {sb.island === 'activity' && !sb.bubble && <div style={sub}>Activity text <input id="sb-act" style={field} value={sb.act} onChange={e => up({ act: e.target.value })} /></div>}
        <div style={sub}>Island icon <Seg id="sb-islandicon" value={sb.islandIcon} onChange={v => up({ islandIcon: v })} opts={[['ring', 'Ring'], ['arrow', 'Arrow'], ['lock', 'Lock'], ['none', 'None']]} /></div>
        {!(sb.island === 'activity' || sb.bubble) && sb.islandIcon !== 'lock' && <div style={{ ...sub, color: '#6e6e73', fontSize: 11 }}>Ring and arrow show with an activity or bubble.</div>}
        {((sb.island === 'activity' || sb.bubble) && sb.islandIcon === 'ring' || sb.bubble && sb.bubbleIcon === 'ring') && <div style={sub}>Ring <input id="sb-ring" type="range" min={0} max={100} value={Math.round(sb.ring * 100)} onChange={e => up({ ring: Number(e.target.value) / 100 })} style={{ flex: 1 }} /></div>}
        <Check id="sb-homebar" label="Home indicator" on={sb.homeBar} set={v => up({ homeBar: v })} />
        <Check id="sb-bubble" label="Bubble" on={sb.bubble} set={v => up({ bubble: v })} />
        {sb.bubble && <div style={sub}>Bubble icon <Seg id="sb-bubbleicon" value={sb.bubbleIcon} onChange={v => up({ bubbleIcon: v })} opts={[['ring', 'Ring'], ['arrow', 'Arrow'], ['none', 'None']]} /></div>}
  </div>
}

export function StatusPanel({ sb, onChange }: { sb: SbCfg; onChange: (c: SbCfg) => void }) {
  const [open, setOpen] = useState(true)
  const [hidden, setHidden] = useState(false)
  const [rk, setRk] = useState(0)
  const box: React.CSSProperties = { position: 'absolute', top: 52, right: 16, font: '13px -apple-system, system-ui, sans-serif', color: '#1d1d1f',
    background: 'rgba(255,255,255,0.8)', borderRadius: 8, padding: '6px 10px', backdropFilter: 'blur(8px)' }
  if (hidden) return <button id="sb-show" onPointerDown={e => e.stopPropagation()} onClick={() => setHidden(false)} style={{ ...box, border: 0, cursor: 'pointer', fontWeight: 600 }}>Status bar</button>
  const small: React.CSSProperties = { font: 'inherit', fontSize: 12, border: '1px solid #c7c7cc', borderRadius: 5, background: '#fff', color: '#1d1d1f', cursor: 'pointer' }
  return (
    <div id="sb-panel" onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()} style={{ ...box, width: 280, maxHeight: 'calc(100vh - 110px)', overflowY: 'auto' }}>
      <div style={row}>
        <button id="sb-toggle" onClick={() => setOpen(!open)} style={{ font: 'inherit', fontWeight: 600, border: 0, background: 'none', padding: 0, cursor: 'pointer', color: '#1d1d1f' }}>{open ? '▾' : '▸'} Status bar</button>
        <span style={{ display: 'flex', gap: 6 }}>
          <button id="sb-reset" onClick={() => { onChange(SB_DEFAULT); setRk(rk + 1) }} style={small}>Reset</button>
          <button id="sb-hide" onClick={() => setHidden(true)} style={small}>Hide</button>
        </span>
      </div>
      {open && <div style={{ marginTop: 6 }}><StatusBarControls sb={sb} onChange={onChange} resetKey={rk} /></div>}
    </div>
  )
}
