//
//  SafariWebExtensionHandler.swift
//  Price Tracker — Safari Web Extension
//
//  This is the native bridge between Safari and the web extension. Safari
//  instantiates it whenever the extension sends a native message
//  (browser.runtime.sendNativeMessage). Price Tracker runs entirely inside the
//  web-extension JavaScript, so this handler simply acknowledges native
//  messages — it's the hook you'd extend if you later wanted native features
//  (e.g. Keychain-backed storage or a shared app group).
//
//  The `xcrun safari-web-extension-converter` tool generates an equivalent
//  file automatically; this copy is kept in the repo so the native side is
//  documented and reviewable alongside the extension resources.
//

import SafariServices
import os.log

let SFExtensionMessageKey = "message"

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let profile: UUID?
        if #available(iOS 17.0, macOS 14.0, *) {
            profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        } else {
            profile = request?.userInfo?["profile"] as? UUID
        }

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        os_log(.default, "Price Tracker received native message: %@ (profile: %@)",
               String(describing: message), profile?.uuidString ?? "none")

        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: ["echo": message ?? NSNull()]]

        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
