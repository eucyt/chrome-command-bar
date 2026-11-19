"""Real key presses and screenshots on the X display, for end-to-end tests.

Puppeteer's keyboard reaches the page only. Extension shortcuts are handled by
the browser itself, so they need key events from the X server (XTEST).

  python3 xkeys.py key ctrl+shift+k
  python3 xkeys.py shot out.png
"""
import sys
import time

from Xlib import X, XK, display
from Xlib.ext import xtest

MODS = {"ctrl": "Control_L", "shift": "Shift_L", "alt": "Alt_L", "super": "Super_L"}
NAMED = {"enter": "Return", "esc": "Escape", "backspace": "BackSpace", "down": "Down", "up": "Up", "tab": "Tab"}


def focus_browser(d):
    """Without a window manager nothing owns the keyboard, so hand it to the biggest window."""
    root = d.screen().root
    best = None
    for w in root.query_tree().children:
        attrs = w.get_attributes()
        geo = w.get_geometry()
        if attrs.map_state == X.IsViewable and (best is None or geo.width * geo.height > best[1]):
            best = (w, geo.width * geo.height)
    if best:
        best[0].set_input_focus(X.RevertToParent, X.CurrentTime)
        d.sync()


def press(d, combo):
    names = [MODS.get(p, NAMED.get(p, p)) for p in combo.lower().split("+")]
    codes = [d.keysym_to_keycode(XK.string_to_keysym(n)) for n in names]
    if 0 in codes:
        raise SystemExit(f"unknown key in {combo!r}: {names}")
    for c in codes:
        xtest.fake_input(d, X.KeyPress, c)
        d.sync()
        time.sleep(0.02)
    for c in reversed(codes):
        xtest.fake_input(d, X.KeyRelease, c)
        d.sync()
        time.sleep(0.02)


def shot(d, path):
    from PIL import Image

    root = d.screen().root
    geo = root.get_geometry()
    raw = root.get_image(0, 0, geo.width, geo.height, X.ZPixmap, 0xFFFFFFFF)
    Image.frombytes("RGB", (geo.width, geo.height), raw.data, "raw", "BGRX").save(path)


if __name__ == "__main__":
    d = display.Display()
    cmd, arg = sys.argv[1], sys.argv[2]
    if cmd == "key":
        if "--no-focus" not in sys.argv:
            focus_browser(d)
        press(d, arg)
    elif cmd == "shot":
        shot(d, arg)
    else:
        raise SystemExit(__doc__)
