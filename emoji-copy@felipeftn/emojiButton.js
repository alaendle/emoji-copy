import St from "gi://St";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";

const Clipboard = St.Clipboard.get_default();
const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;

const VirtualKeyboard = (() => {
  let VirtualKeyboard;
  return () => {
    if (!VirtualKeyboard) {
      VirtualKeyboard = Clutter.get_default_backend()
        .get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }
    return VirtualKeyboard;
  };
})();

const GENDERS = ["", "\u200D\u2640\uFE0F", "\u200D\u2642\uFE0F"];
const GENDERS2 = ["👩", "👨"];
const TONES = ["", "🏻", "🏼", "🏽", "🏾", "🏿"];

export class EmojiButton {
  constructor(emojiCopy, baseCharacter, keywords) {
    this.baseCharacter = baseCharacter;
    this.emojiCopy = emojiCopy;
    this._settings = this.emojiCopy._settings;

    let tonable = false;
    let genrable = false;
    let gendered = false;
    for (let j = 0; j < keywords.length; j++) {
      if (keywords[j] == "HAS_TONE") {
        tonable = true;
      } else if (keywords[j] == "HAS_GENDER") {
        genrable = true;
      } else if (keywords[j] == "IS_GENDERED") {
        gendered = true;
      }
    }
    this.tags = [tonable, genrable, gendered];
    this.keywords = keywords;
  }

  build(category) {
    this.super_btn = new St.Button({
      style_class: "EmojisItemStyle",
      can_focus: true,
      label: this.baseCharacter,
    });

    // Copy the emoji to the clipboard with adequate tags and behavior
    this.super_btn.connect("button-press-event", this.onButtonPress.bind(this));
    this.super_btn.connect("key-press-event", this.onKeyPress.bind(this));

    if (category == null || this.keywords == []) {
      return;
    }

    // Update the category label on hover, allowing the user to know the
    // name of the emoji he's copying.
    this.super_btn.connect("notify::hover", (a, _) => {
      if (a.hover) {
        category.super_item.label.text = this.keywords[0];
      } else {
        category.super_item.label.text = category.categoryName;
      }
    });
  }

  destroy() {
    if (this._pasteHackCallbackId) {
      this._pasteHackCallbackId = null;
    }
    this.super_btn.destroy();
  }

  updateStyle(forcedStyle) {
    let fontStyle;
    if (forcedStyle) {
      fontStyle = forcedStyle;
    } else {
      fontStyle = "font-size: " + this._settings.get_int("emojisize") +
        "px;";
      fontStyle += " color: #FFFFFF;";
    }
    this.super_btn.style = fontStyle;
  }

  onKeyPress(_, e) {
    let symbol = e.get_key_symbol();
    // Main return key (GS > 3.35)     Main return key (GS < 3.35)           Numpad return key
    if (
      symbol == Clutter.KEY_Return || symbol == Clutter.Return ||
      symbol == Clutter.KP_Enter
    ) {
      let emojiToCopy = this.getTaggedEmoji();
      let [mods] = global.get_pointer();
      let majPressed = (mods & Clutter.ModifierType.SHIFT_MASK) != 0;
      let ctrlPressed = (mods & Clutter.ModifierType.CONTROL_MASK) != 0;
      if (majPressed) {
        return this.addToClipboardAndStay(emojiToCopy);
      } else if (ctrlPressed) {
        return this.replaceClipboardAndStay(emojiToCopy);
      } else {
        return this.replaceClipboardAndClose(emojiToCopy);
      }
    }
    return Clutter.EVENT_PROPAGATE;
  }

  /*
   * This method is called at each click and copies the emoji to the clipboard.
   * The exact behavior of the method depends on the mouse button used:
   * - left click overwrites clipboard content with the emoji and closes the menu;
   * - middle click too, but does not close the menu;
   * - right click adds the emoji at the end of the current clipboard content (and does not close the menu).
   */
  onButtonPress(_, event) {
    let mouseButton = event.get_button();
    let emojiToCopy = this.getTaggedEmoji();
    if (emojiToCopy == null) {
      return Clutter.EVENT_PROPAGATE;
    }

    if (mouseButton == 1) {
      return this.replaceClipboardAndClose(emojiToCopy);
    } else if (mouseButton == 2) {
      return this.replaceClipboardAndStay(emojiToCopy);
    } else if (mouseButton == 3) {
      return this.addToClipboardAndStay(emojiToCopy);
    }
    return Clutter.EVENT_PROPAGATE;
  }

  replaceClipboardAndClose(emojiToCopy) {
    Clipboard.set_text(
      CLIPBOARD_TYPE,
      emojiToCopy,
    );
    this.emojiCopy.get_super_btn().menu.close();

    if (this._settings.get_boolean("paste-on-select")) {
      this.triggerPasteHack();
    }

    return Clutter.EVENT_STOP;
  }

  replaceClipboardAndStay(emojiToCopy) {
    Clipboard.set_text(
      CLIPBOARD_TYPE,
      emojiToCopy,
    );

    if (this._settings.get_boolean("paste-on-select")) {
      this.triggerPasteHack();
    }

    return Clutter.EVENT_STOP;
  }

  addToClipboardAndStay(emojiToCopy) {
    Clipboard.get_text(CLIPBOARD_TYPE, function (_, text) {
      Clipboard.set_text(
        CLIPBOARD_TYPE,
        text + emojiToCopy,
      );
    });

    if (this._settings.get_boolean("paste-on-select")) {
      this.triggerPasteHack();
    }

    return Clutter.EVENT_STOP;
  }

  /*
   * This returns an emoji corresponding to .super_btn.label with tags applied
   * to it. `tags` is an array of 3 booleans, which describe how a composite
   * emoji is built:
   * - tonable -> return emoji concatenated with the selected skin tone;
   * - genrable -> return emoji concatenated with the selected gender;
   * - gendered -> the emoji is already gendered, which modifies the way skin
   *   tone is applied ([man|woman] + [skin tone if any] + [other symbol(s)]).
   * If all tags are false, it returns unmodified .super_btn.label
   */
  getTaggedEmoji() {
    let currentEmoji = this.super_btn.label;
    if (currentEmoji == "") return;

    let tonable = this.tags[0];
    let genrable = this.tags[1];
    let gendered = this.tags[2];
    let temp = currentEmoji;
    if (tonable) {
      let tone_index = this._settings.get_int("skin-tone");
      if (gendered) {
        if (temp.includes(GENDERS2[0])) {
          currentEmoji = currentEmoji.replace(
            GENDERS2[0],
            GENDERS2[0] + TONES[tone_index],
          );
        } else if (temp.includes(GENDERS2[1])) {
          currentEmoji = currentEmoji.replace(
            GENDERS2[1],
            GENDERS2[1] + TONES[tone_index],
          );
        } else {
          console.error(
            "Error: " + GENDERS2[0] + " isn't a valid gender prefix.",
          );
        }
        temp = currentEmoji;
      } else {
        temp += TONES[tone_index];
      }
    }
    if (genrable) {
      temp += GENDERS[this._settings.get_int("gender")];
    }
    this.emojiCopy.searchItem.shiftFor(temp);
    return temp;
  }

  // PR #189 from khaled-0 at maoschanz/emoji-selector-for-gnome
  // Originally from "clipboard-histroy@alexsaveau.dev"
  triggerPasteHack() {
    this._pasteHackCallbackId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      1,
      () => {
        const eventTime = Clutter.get_current_event_time() * 1000;
        VirtualKeyboard().notify_keyval(
          eventTime,
          Clutter.KEY_Shift_L,
          Clutter.KeyState.PRESSED,
        );
        VirtualKeyboard().notify_keyval(
          eventTime,
          Clutter.KEY_Insert,
          Clutter.KeyState.PRESSED,
        );
        VirtualKeyboard().notify_keyval(
          eventTime,
          Clutter.KEY_Insert,
          Clutter.KeyState.RELEASED,
        );
        VirtualKeyboard().notify_keyval(
          eventTime,
          Clutter.KEY_Shift_L,
          Clutter.KeyState.RELEASED,
        );

        this._pasteHackCallbackId = undefined;
        return false;
      },
    );
  }
}
