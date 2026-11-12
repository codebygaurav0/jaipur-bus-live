import { Component } from "react";

/**
 * EmergencyErrorBoundary
 * Ensures that if any unexpected error occurs inside EmergencyView,
 * the user is NEVER left without direct emergency dialing access.
 */
export default class EmergencyErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("EmergencyView ErrorBoundary caught error:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="emergency-premium"
          style={{
            minHeight: "70vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px 16px",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          <div
            style={{
              maxWidth: "540px",
              width: "100%",
              background: "#ffffff",
              border: "1px solid #e6dfd1",
              borderRadius: "20px",
              padding: "32px 24px",
              textAlign: "center",
              boxShadow: "0 10px 30px -5px rgba(6, 78, 59, 0.1)",
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "16px",
                background: "#fef2f2",
                color: "#dc2626",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "26px",
                marginBottom: "16px",
                border: "1px solid #fecaca",
              }}
            >
              🚨
            </div>

            <h2
              style={{
                margin: "0 0 8px",
                fontSize: "20px",
                fontWeight: 850,
                color: "#0f172a",
              }}
            >
              Emergency Dialers Active
            </h2>

            <p
              style={{
                margin: "0 0 20px",
                fontSize: "13.5px",
                color: "#475569",
                lineHeight: 1.6,
              }}
            >
              A temporary display error occurred in the interactive guide. Immediate
              emergency phone connections remain active below:
            </p>

            {/* Direct Fallback Call Buttons */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                marginBottom: "24px",
              }}
            >
              <a
                href="tel:112"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 18px",
                  background: "#dc2626",
                  color: "#ffffff",
                  borderRadius: "14px",
                  textDecoration: "none",
                  fontWeight: 800,
                  fontSize: "15px",
                  boxShadow: "0 4px 12px rgba(220, 38, 38, 0.3)",
                }}
              >
                <span>🚨 Call 112 (Universal Emergency / Police)</span>
                <span style={{ fontSize: "18px" }}>›</span>
              </a>

              <a
                href="tel:108"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 18px",
                  background: "#065f46",
                  color: "#ffffff",
                  borderRadius: "14px",
                  textDecoration: "none",
                  fontWeight: 800,
                  fontSize: "15px",
                  boxShadow: "0 4px 12px rgba(6, 95, 70, 0.3)",
                }}
              >
                <span>🚑 Call 108 (Medical Ambulance)</span>
                <span style={{ fontSize: "18px" }}>›</span>
              </a>

              <a
                href="tel:101"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 18px",
                  background: "#ea580c",
                  color: "#ffffff",
                  borderRadius: "14px",
                  textDecoration: "none",
                  fontWeight: 800,
                  fontSize: "15px",
                  boxShadow: "0 4px 12px rgba(234, 88, 12, 0.3)",
                }}
              >
                <span>🚒 Call 101 (Fire Brigade Control)</span>
                <span style={{ fontSize: "18px" }}>›</span>
              </a>
            </div>

            <div
              style={{
                display: "flex",
                gap: "10px",
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={this.handleRetry}
                style={{
                  padding: "10px 18px",
                  background: "#0f172a",
                  color: "#ffffff",
                  borderRadius: "10px",
                  fontSize: "13px",
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Reload Emergency Guide
              </button>

              {this.props.onBackToBus && (
                <button
                  type="button"
                  onClick={this.props.onBackToBus}
                  style={{
                    padding: "10px 18px",
                    background: "#f1f5f9",
                    color: "#334155",
                    borderRadius: "10px",
                    fontSize: "13px",
                    fontWeight: 700,
                    border: "1px solid #cbd5e1",
                    cursor: "pointer",
                  }}
                >
                  Return to Bus Tracking
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
