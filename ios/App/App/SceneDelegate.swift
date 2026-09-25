import UIKit
import Capacitor

/**
 * UIScene lifecycle support.
 *
 * WHY THIS EXISTS: the iOS 26 SDK refuses to launch an app that has not
 * adopted UIScene ("UIScene life cycle is required for apps built with this
 * SDK"). Capacitor's project template still ships the pre-iOS 13
 * UIApplicationDelegate layout, so the app had no scene manifest and no
 * scene delegate at all.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: it never creates a UIWindow and never
 * instantiates a root view controller. Info.plist's scene configuration names
 * Main.storyboard via UISceneStoryboardFile, so UIKit builds the window and
 * the CAPBridgeViewController exactly as it did before, through the same
 * storyboard. Creating one here as well would put a second window on screen
 * and give the app two competing lifecycles -- the failure mode this
 * migration most easily produces.
 *
 * WHAT IT MUST DO: once an app is scene-based, UIKit stops calling
 * UIApplicationDelegate's `application(_:open:options:)` and
 * `application(_:continue:restorationHandler:)` and routes both to the scene
 * delegate instead. Those two callbacks are how Capacitor delivers custom-URL
 * opens and Universal Links to the web layer (see CAPApplicationDelegateProxy,
 * which posts .capacitorOpenURL and .capacitorOpenUniversalLink). Without the
 * forwarding below, adopting scenes would silently break every deep link and
 * every OAuth redirect that returns to the app -- the app would launch, and
 * the breakage would only show up later, in sign-in.
 *
 * Each method hands the work to the same ApplicationDelegateProxy.shared the
 * AppDelegate used, so the behaviour delivered to plugins is unchanged.
 */
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    /// Set by UIKit when it creates the window from Main.storyboard. Never
    /// assigned here.
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard scene is UIWindowScene else {
            return
        }

        // A cold launch triggered by a URL or a Universal Link carries it here
        // instead of through the AppDelegate, so it has to be drained or the
        // very first deep link into the app would be dropped.
        for context in connectionOptions.urlContexts {
            deliver(url: context.url, options: context.options)
        }

        for userActivity in connectionOptions.userActivities {
            deliver(userActivity: userActivity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            deliver(url: context.url, options: context.options)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        deliver(userActivity: userActivity)
    }

    // MARK: - Forwarding

    private func deliver(url: URL, options: UIScene.OpenURLOptions) {
        // Rebuilt rather than passed through: the scene API hands over
        // UIScene.OpenURLOptions, while Capacitor's proxy expects the
        // UIApplication form. The values themselves are carried across
        // unchanged.
        var applicationOptions: [UIApplication.OpenURLOptionsKey: Any] = [
            .openInPlace: options.openInPlace
        ]

        if let sourceApplication = options.sourceApplication {
            applicationOptions[.sourceApplication] = sourceApplication
        }

        if let annotation = options.annotation {
            applicationOptions[.annotation] = annotation
        }

        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            open: url,
            options: applicationOptions
        )
    }

    private func deliver(userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            continue: userActivity,
            restorationHandler: { _ in }
        )
    }
}
