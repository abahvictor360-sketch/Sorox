import UIKit
import Capacitor

/// Soro X Tablet: the Capacitor bridge view, with the iPad's edge-swipe "back"
/// gesture turned on so a swipe from the left edge returns from the desktop's
/// companion page to the pairing screen (Android uses its Back button).
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
    }
}
