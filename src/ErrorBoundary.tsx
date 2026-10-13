import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode; label: string }
type State = { error: Error | null }

/** Catches a render or WebGL failure so the page shows what went wrong instead of going blank. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error) { console.error(`[Openmock] ${this.props.label} failed:`, error) }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, font: '14px system-ui, sans-serif', color: '#222' }}>
        <div style={{ maxWidth: 440, background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 4px 24px rgba(0,0,0,.12)' }}>
          <strong>The {this.props.label} couldn't load.</strong>
          <p style={{ margin: '8px 0', color: '#555' }}>Try again, or reload the page. If it keeps happening, the details below explain why.</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#f4f4f5', padding: 8, borderRadius: 6, maxHeight: 160, overflow: 'auto' }}>{error.message}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginRight: 8 }}>Try again</button>
          <button onClick={() => location.reload()}>Reload page</button>
        </div>
      </div>)
  }
}
