import { Component } from 'react'
import * as Sentry from '@sentry/react'

// Catches render errors in the page area so a single bad record can't white-screen
// the whole app. Shows a small fallback (and a reset) instead of crashing. `resetKey`
// changes when the user navigates, which clears the error so they can move on.
// Caught errors are reported to Sentry (a no-op if Sentry isn't configured).
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack } } })
  }

  componentDidUpdate(prev) {
    // Clear the error when the view changes (e.g. user clicks another page).
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty-state">
          <p>Something went wrong displaying this view.</p>
          <p className="muted small">{String(this.state.error?.message || this.state.error)}</p>
          <button className="linkbtn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
