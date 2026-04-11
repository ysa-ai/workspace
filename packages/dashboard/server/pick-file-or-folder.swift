import AppKit

let panel = NSOpenPanel()
panel.canChooseFiles = true
panel.canChooseDirectories = true
panel.allowsMultipleSelection = false
panel.canCreateDirectories = false

NSApp.setActivationPolicy(.regular)
NSApp.activate(ignoringOtherApps: true)

if panel.runModal() == .OK, let url = panel.url {
    print(url.path)
} else {
    exit(1)
}
