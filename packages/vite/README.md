# @molt/vite

The Vite adapter maps explicit module events to `Runtime.install`, `Runtime.replace`, and
`Runtime.uninstall`. It loads a replacement definition before calling the runtime, so an import
failure cannot withdraw the old generation. Setup and commit failures are handled by the core
replacement transaction.
