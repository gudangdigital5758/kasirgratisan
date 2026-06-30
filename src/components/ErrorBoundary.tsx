import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import i18n from "@/i18n";
import { APP_VERSION } from "@/lib/app-version";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (args: { error: Error; reset: () => void }) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showConsentOpen: boolean;
  reporting: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, errorInfo: null, showConsentOpen: false, reporting: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Captured error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  reset = (): void => {
    this.setState({ error: null, errorInfo: null });
  };

  reload = (): void => {
    window.location.reload();
  };

  goHome = (): void => {
    window.location.href = "/";
  };

  copyDetails = async (): Promise<void> => {
    const { error, errorInfo } = this.state;
    if (!error) return;

    const details = [
      `Message: ${error.message}`,
      `Name: ${error.name}`,
      `URL: ${window.location.href}`,
      `User Agent: ${navigator.userAgent}`,
      `Time: ${new Date().toISOString()}`,
      "",
      "Stack:",
      error.stack ?? "(no stack)",
      "",
      "Component Stack:",
      errorInfo?.componentStack ?? "(no component stack)",
    ].join("\n");

    try {
      await navigator.clipboard.writeText(details);
    } catch {
      window.prompt(i18n.t('common:error.copyPrompt'), details);
    }
  };

  submitReport = async (): Promise<void> => {
    const { error, errorInfo } = this.state;
    if (!error) return;

    this.setState({ reporting: true });

    const details = [
      `Message: ${error.message}`,
      `Name: ${error.name}`,
      `URL: ${window.location.href}`,
      `User Agent: ${navigator.userAgent}`,
      `Time: ${new Date().toISOString()}`,
      "",
      "Stack:",
      error.stack ?? "(no stack)",
      "",
      "Component Stack:",
      errorInfo?.componentStack ?? "(no component stack)",
    ].join("\n");

    const deviceInfo = {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      online: navigator.onLine,
      url: window.location.href,
      time: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      appVersion: APP_VERSION,
    };

    try {
      const response = await fetch("https://external-api.freekasir.com/webhook/issue-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          error_log: details,
          device_info: deviceInfo,
        }),
      });

      if (response.ok) {
        alert(i18n.t("common:error.sendSuccess"));
        this.setState({ showConsentOpen: false });
        this.goHome();
      } else {
        alert(i18n.t("common:error.sendFailed"));
      }
    } catch (err) {
      console.error("Gagal mengirim laporan:", err);
      alert(i18n.t("common:error.networkError"));
    } finally {
      this.setState({ reporting: false });
    }
  };

  render(): ReactNode {
    const { error, errorInfo } = this.state;
    const { children, fallback } = this.props;

    if (!error) {
      return children;
    }

    if (fallback) {
      return fallback({ error, reset: this.reset });
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-muted px-4 py-8">
        <div className="w-full max-w-lg space-y-4">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{i18n.t('common:error.title')}</AlertTitle>
            <AlertDescription>
              {i18n.t('common:error.description')}
            </AlertDescription>
          </Alert>

          <div className="rounded-lg border bg-background p-4">
            <div className="mb-2 text-sm font-medium">{i18n.t('common:error.details')}</div>
            <pre className="max-h-48 overflow-auto rounded bg-muted p-3 text-xs leading-relaxed">
              {error.name}: {error.message}
              {error.stack ? `\n\n${error.stack}` : ""}
              {errorInfo?.componentStack ? `\n\nComponent stack:${errorInfo.componentStack}` : ""}
            </pre>
          </div>

          <Button onClick={() => this.setState({ showConsentOpen: true })} className="w-full gap-2 h-11">
            <Send className="h-4 w-4" />
            {i18n.t("common:error.reportIssue")}
          </Button>
        </div>

        <AlertDialog open={this.state.showConsentOpen} onOpenChange={(open) => this.setState({ showConsentOpen: open })}>
          <AlertDialogContent className="max-w-[90vw] rounded-xl bg-background border text-foreground">
            <AlertDialogHeader>
              <AlertDialogTitle>{i18n.t("common:error.reportTitle")}</AlertDialogTitle>
              <AlertDialogDescription className="text-sm whitespace-pre-line">
                {i18n.t("common:error.reportDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row justify-end gap-2 mt-4">
              <AlertDialogCancel disabled={this.state.reporting} className="mt-0">
                {i18n.t("common:error.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction 
                onClick={(e) => {
                  e.preventDefault();
                  this.submitReport();
                }}
                disabled={this.state.reporting}
              >
                {this.state.reporting ? i18n.t("common:error.sending") : i18n.t("common:error.agreeAndSend")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }
}

export default ErrorBoundary;
