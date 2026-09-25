import Foundation
import Capacitor
import DeviceCheck
import CryptoKit

/**
 * Bridges Apple's App Attest to the web layer.
 *
 * This is the only part of self-service registration that cannot be done in
 * JavaScript, and it is the part that makes the rest trustworthy: the private
 * key below is generated inside the Secure Enclave and never leaves the
 * device, so a server that verifies an assertion against Apple's root CA
 * knows the request came from a genuine build of this app on genuine Apple
 * hardware. A browser has no way to produce any of it.
 *
 * The plugin deliberately holds no policy: it generates a key, attests it,
 * and signs whatever client data the server asked for. Every decision about
 * what those signatures mean is made server-side, where it cannot be patched
 * by anyone holding the device.
 *
 * NOTE FOR REVIEWERS OF THIS FILE: App Attest is unavailable on the
 * Simulator. DCAppAttestService.isSupported is false there, so the web layer
 * must treat "unsupported" as "registration unavailable" rather than as a
 * reason to fall back to anything weaker.
 */
@objc(AppAttestPlugin)
public class AppAttestPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppAttestPlugin"
    public let jsName = "AppAttest"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "attestKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateAssertion", returnType: CAPPluginReturnPromise)
    ]

    private let service = DCAppAttestService.shared

    @objc func isSupported(_ call: CAPPluginCall) {
        call.resolve(["supported": service.isSupported])
    }

    /// Creates a Secure Enclave key and returns Apple's identifier for it.
    @objc func generateKey(_ call: CAPPluginCall) {
        guard service.isSupported else {
            call.reject("App Attest is not supported on this device")
            return
        }

        service.generateKey { keyId, error in
            if let error = error {
                call.reject("Could not generate an App Attest key", nil, error)
                return
            }

            guard let keyId = keyId else {
                call.reject("Could not generate an App Attest key")
                return
            }

            call.resolve(["keyId": keyId])
        }
    }

    /// Attests a key against the server's challenge, once per install.
    @objc func attestKey(_ call: CAPPluginCall) {
        guard let keyId = call.getString("keyId"),
              let challenge = call.getString("challenge") else {
            call.reject("keyId and challenge are required")
            return
        }

        // The server hashes the same challenge bytes, so what is hashed here
        // must be exactly what the server issued -- no encoding in between.
        let clientDataHash = Data(SHA256.hash(data: Data(challenge.utf8)))

        service.attestKey(keyId, clientDataHash: clientDataHash) { attestation, error in
            if let error = error {
                call.reject("Could not attest the App Attest key", nil, error)
                return
            }

            guard let attestation = attestation else {
                call.reject("Could not attest the App Attest key")
                return
            }

            call.resolve(["attestation": attestation.base64EncodedString()])
        }
    }

    /// Signs one request's client data. Apple increments the key's counter on
    /// every call, which is what lets the server reject a replayed assertion.
    @objc func generateAssertion(_ call: CAPPluginCall) {
        guard let keyId = call.getString("keyId"),
              let clientData = call.getString("clientData") else {
            call.reject("keyId and clientData are required")
            return
        }

        let clientDataHash = Data(SHA256.hash(data: Data(clientData.utf8)))

        service.generateAssertion(keyId, clientDataHash: clientDataHash) { assertion, error in
            if let error = error {
                call.reject("Could not generate an App Attest assertion", nil, error)
                return
            }

            guard let assertion = assertion else {
                call.reject("Could not generate an App Attest assertion")
                return
            }

            call.resolve(["assertion": assertion.base64EncodedString()])
        }
    }
}
