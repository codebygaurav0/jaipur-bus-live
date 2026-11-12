import { Component } from "react";

export default class MetroErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Jaipur Metro Guide ErrorBoundary caught error:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="metro-premium"
          style={{
            minHeight: "60vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              maxWidth: "520px",
              width: "100%",
              background: "#ffffff",
              border: "1px solid var(--m-cream-border)",
              borderRadius: "var(--m-radius-lg)",
              padding: "28px 24px",
              textAlign: "center",
              boxShadow: "var(--m-shadow-md)",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "14px",
                background: "var(--m-pink-tint)",
                color: "var(--m-pink-deep)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px",
                marginBottom: "14px",
              }}
            >
              ⚠️
            </div>
            <h3
              style={{
                margin: "0 0 8px",
                fontSize: "18px",
                fontWeight: 850,
                color: "var(--m-green-deep)",
              }}
            >
              Jaipur Metro Guide Notice
            </h3>
            <p
              style={{
                margin: "0 0 20px",
                fontSize: "13px",
                color: "var(--m-text-secondary)",
                lineHeight: 1.6,
              }}
            >
              A temporary display error occurred while rendering metro information. Your
              data is safe and you can reload the guide or return to bus tracking.
            </p>
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
                  background: "var(--m-green-deep)",
                  color: "#ffffff",
                  borderRadius: "10px",
                  fontSize: "12.5px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Reload Metro Guide
              </button>
              {typeof this.props.onBackToBus === "function" && (
                <button
                  type="button"
                  onClick={this.props.onBackToBus}
                  style={{
                    padding: "10px 18px",
                    background: "var(--m-cream-soft)",
                    border: "1px solid var(--m-cream-border)",
                    color: "var(--m-green-deep)",
                    borderRadius: "10px",
                    fontSize: "12.5px",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  ← Return to Bus Tracking
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

