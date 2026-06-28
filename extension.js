import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { PrefsFields } from './constants.js';
import { EMOJI_DATA } from './emojiData.js';
import { Keyboard } from './keyboard.js';

const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;
const INDICATOR_ICON = 'face-smile-symbolic';
const COLUMNS = 8;
const SEARCH_DEBOUNCE_MS = 80;
const CATEGORY_LABELS = {
    'Smileys & Emotion': 'Faces',
    'People & Body': 'People',
    'Animals & Nature': 'Nature',
    'Food & Drink': 'Food',
    'Travel & Places': 'Places',
    Activities: 'Fun',
    Objects: 'Things',
    Symbols: 'Symbols',
    Flags: 'Flags',
};

export default class EmojiIndicatorExtension extends Extension {
    enable () {
        this.indicator = new EmojiIndicator({
            settings: this.getSettings(),
            openSettings: this.openPreferences,
            uuid: this.uuid,
        });
        Main.panel.addToStatusArea('emojiIndicator', this.indicator, 1);
    }

    disable () {
        this.indicator.destroy();
        this.indicator = null;
    }
}

const EmojiIndicator = GObject.registerClass({
    GTypeName: 'EmojiIndicator',
}, class EmojiIndicator extends PanelMenu.Button {
    _init (extension) {
        super._init(0.0, _('Emoji Indicator'));

        this.extension = extension;
        this.keyboard = new Keyboard();
        this.menu.sourceActor = this;
        this._shortcutsBindingIds = [];
        this._pasteTimeouts = [];
        this._searchTimeoutId = null;
        this._visibleEmojiButtonsList = [];
        this._categoryButtons = new Map();
        this._categories = [...new Set(EMOJI_DATA.map(item => item.category))];
        this._selectedCategory = this._categories[0];
        this._emojiByGlyph = new Map(EMOJI_DATA.map(item => [item.emoji, item]));
        this._cursorActor = new Clutter.Actor({ opacity: 0, width: 1, height: 1 });
        Main.uiGroup.add_child(this._cursorActor);

        this._loadSettings();
        this._buildIndicator();
        this._buildMenu();
        this._bindSettings();
        this._refreshDynamicSections();
        this._queueEmojiFilter('');
    }

    destroy () {
        this._unbindShortcuts();

        this.extension.settings.disconnectObject(this);
        this.menu.disconnectObject(this);
        this.searchEntry.get_clutter_text().disconnectObject(this);

        this._pasteTimeouts.forEach(id => clearTimeout(id));
        this._pasteTimeouts = [];
        if (this._searchTimeoutId) {
            clearTimeout(this._searchTimeoutId);
            this._searchTimeoutId = null;
        }
        this.keyboard.destroy();

        if (this._cursorActor) {
            if (this._cursorActor.get_parent())
                Main.uiGroup.remove_child(this._cursorActor);
            this._cursorActor.destroy();
            this._cursorActor = null;
        }

        super.destroy();
    }

    _loadSettings () {
        const { settings } = this.extension;
        this.enableKeybindings = settings.get_boolean(PrefsFields.ENABLE_KEYBINDING);
        this.openAtCursor = settings.get_boolean(PrefsFields.OPEN_AT_CURSOR);
        this.recentLimit = settings.get_int(PrefsFields.RECENT_LIMIT);
        this.visibleEmojiLimit = settings.get_int(PrefsFields.VISIBLE_EMOJI_LIMIT);
        this.popupWidth = settings.get_int(PrefsFields.POPUP_WIDTH);
        this.uiScale = settings.get_int(PrefsFields.UI_SCALE);
        this.showFavorites = settings.get_boolean(PrefsFields.SHOW_FAVORITES);
        this.showRecents = settings.get_boolean(PrefsFields.SHOW_RECENTS);
        this.favorites = settings.get_strv(PrefsFields.FAVORITES);
        this.recents = settings.get_strv(PrefsFields.RECENTS);
    }

    _bindSettings () {
        this.extension.settings.connectObject('changed', () => {
            this._loadSettings();

            if (this.enableKeybindings)
                this._bindShortcuts();
            else
                this._unbindShortcuts();

            this._refreshDynamicSections();
            this._applyLayoutSettings();
            this._queueEmojiFilter(this.searchEntry.get_text());
        }, this);

        if (this.enableKeybindings)
            this._bindShortcuts();
    }

    _buildIndicator () {
        const hbox = new St.BoxLayout({
            style_class: 'panel-status-menu-box emoji-indicator-hbox',
        });
        this.icon = new St.Icon({
            icon_name: INDICATOR_ICON,
            style_class: 'system-status-icon emoji-indicator-icon',
        });

        hbox.add_child(this.icon);
        this.add_child(hbox);
    }

    _buildMenu () {
        this.searchItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this.searchEntry = new St.Entry({
            name: 'emojiSearchEntry',
            style_class: 'search-entry emoji-search-entry',
            hint_text: _('Search emoji...'),
            can_focus: true,
            track_hover: true,
            x_expand: true,
            primary_icon: new St.Icon({ icon_name: 'edit-find-symbolic' }),
        });
        this.searchEntry.get_clutter_text().connectObject('text-changed', () => {
            this._queueEmojiFilter(this.searchEntry.get_text());
        }, this);
        this.searchEntry.get_clutter_text().connectObject('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Down) {
                const first = this._visibleEmojiButtons()[0];
                if (first)
                    first.grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }, this);
        this.searchItem.add_child(this.searchEntry);
        this.menu.addMenuItem(this.searchItem);

        this.categoriesLabel = this._createSectionLabel(_('Categories'));
        this.categoryItem = this._wrapActor(this._buildCategoryBar());
        this.menu.addMenuItem(this.categoriesLabel);
        this.menu.addMenuItem(this.categoryItem);

        this.favoritesLabel = this._createSectionLabel(_('Favorites'));
        this.favoritesGrid = this._createGrid();
        this.favoritesItem = this._wrapActor(this.favoritesGrid);
        this.menu.addMenuItem(this.favoritesLabel);
        this.menu.addMenuItem(this.favoritesItem);

        this.recentsLabel = this._createSectionLabel(_('Recent'));
        this.recentsGrid = this._createGrid();
        this.recentsItem = this._wrapActor(this.recentsGrid);
        this.menu.addMenuItem(this.recentsLabel);
        this.menu.addMenuItem(this.recentsItem);

        this.allLabel = this._createSectionLabel(this._selectedCategory);
        this.menu.addMenuItem(this.allLabel);

        this.scrollView = new St.ScrollView({
            style_class: 'emoji-scroll-view',
            overlay_scrollbars: true,
        });
        this.allGrid = this._createGrid();
        this.scrollView.add_child(this.allGrid);
        this.menu.addMenuItem(this._wrapActor(this.scrollView));

        this.settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
        this.settingsItem.insert_child_at_index(new St.Icon({
            icon_name: 'org.gnome.Settings-symbolic',
            style_class: 'popup-menu-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }), 0);
        this.settingsItem.connectObject('activate', () => {
            this.extension.openSettings();
            this.menu.close();
        }, this);
        this.menu.addMenuItem(this.settingsItem);

        this.menu.connectObject('open-state-changed', (_menu, open) => {
            if (open) {
                const id = setTimeout(() => {
                    this.searchEntry.set_text('');
                    global.stage.set_key_focus(this.searchEntry);
                }, 50);
                this._pasteTimeouts.push(id);
            } else {
                this.menu.sourceActor = this;
            }
        }, this);

        this._renderEmojiResults('');
        this._applyLayoutSettings();
    }

    _createSectionLabel (text) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'emoji-section-label-item',
        });
        item.label = new St.Label({
            text,
            style_class: 'emoji-section-label',
        });
        item.add_child(item.label);
        return item;
    }

    _wrapActor (actor) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'emoji-actor-wrapper',
        });
        item.add_child(actor);
        return item;
    }

    _createGrid () {
        return new St.BoxLayout({
            vertical: true,
            style_class: 'emoji-grid',
        });
    }

    _buildCategoryBar () {
        const bar = new St.BoxLayout({
            vertical: true,
            style_class: 'emoji-category-bar',
        });

        let row = null;
        this._categories.forEach((category, index) => {
            if (index % 5 === 0) {
                row = new St.BoxLayout({ style_class: 'emoji-category-row' });
                bar.add_child(row);
            }

            const button = new St.Button({
                style_class: 'emoji-category-button',
                can_focus: true,
                reactive: true,
                track_hover: true,
                label: CATEGORY_LABELS[category] || category,
                accessible_name: category,
            });
            button.connectObject('clicked', () => this._selectCategory(category), this);
            this._categoryButtons.set(category, button);
            row.add_child(button);
        });

        this._updateCategoryButtons();
        return bar;
    }

    _applyLayoutSettings () {
        const scale = this.uiScale / 100;
        const width = Math.round(this.popupWidth);
        const buttonSize = Math.round(42 * scale);
        const emojiSize = Math.round(24 * scale);
        const compactEmojiSize = Math.round(22 * scale);
        const categorySize = Math.max(10, Math.round(12 * scale));
        const scrollHeight = Math.round(390 * scale);

        this.searchEntry.set_width(width);
        this.scrollView.set_size(width, scrollHeight);
        this._dynamicButtonSize = buttonSize;
        this._dynamicEmojiStyle = `font-size: ${emojiSize}px;`;
        this._dynamicCompactEmojiStyle = `font-size: ${compactEmojiSize}px;`;
        this._dynamicCategoryStyle = `font-size: ${categorySize}px;`;

        for (const button of this._categoryButtons.values())
            button.set_style(this._dynamicCategoryStyle);

        for (const button of this._collectGridButtons(this.allGrid))
            this._applyEmojiButtonStyle(button, false);

        for (const button of this._collectGridButtons(this.favoritesGrid))
            this._applyEmojiButtonStyle(button, true);

        for (const button of this._collectGridButtons(this.recentsGrid))
            this._applyEmojiButtonStyle(button, true);
    }

    _refreshDynamicSections () {
        this._setSectionVisible(this.favoritesLabel, this.favoritesItem,
            this.showFavorites && this.favorites.length > 0);
        this._setSectionVisible(this.recentsLabel, this.recentsItem,
            this.showRecents && this.recents.length > 0);

        this.favoritesGrid.destroy_all_children();
        this.recentsGrid.destroy_all_children();

        const favoriteEntries = this.favorites
            .map(emoji => this._emojiByGlyph.get(emoji))
            .filter(Boolean);
        const recentEntries = this.recents
            .filter(emoji => !this.favorites.includes(emoji))
            .map(emoji => this._emojiByGlyph.get(emoji))
            .filter(Boolean);

        this._appendEmojiRows(this.favoritesGrid, favoriteEntries, true);
        this._appendEmojiRows(this.recentsGrid, recentEntries, true);
    }

    _setSectionVisible (label, item, visible) {
        label.actor.visible = visible;
        item.actor.visible = visible;
    }

    _appendEmojiRows (grid, entries, compact) {
        let row = null;
        entries.forEach((entry, index) => {
            if (index % COLUMNS === 0) {
                row = new St.BoxLayout({ style_class: 'emoji-grid-row' });
                grid.add_child(row);
            }
            row.add_child(this._createEmojiButton(entry, compact));
        });
    }

    _createEmojiButton (entry, compact) {
        const button = new St.Button({
            style_class: this.favorites.includes(entry.emoji)
                ? 'emoji-button emoji-button-favorite'
                : 'emoji-button',
            can_focus: true,
            reactive: true,
            track_hover: true,
            accessible_name: entry.name,
        });
        this._applyEmojiButtonStyle(button, compact);

        const label = new St.Label({
            text: entry.emoji,
            style_class: compact ? 'emoji-glyph emoji-glyph-compact' : 'emoji-glyph',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        label.set_style(compact
            ? (this._dynamicCompactEmojiStyle || '')
            : (this._dynamicEmojiStyle || ''));
        button.set_child(label);
        button._emojiEntry = entry;
        button._searchText = this._searchText(entry);

        button.connectObject('clicked', () => this._pasteEmoji(entry), this);
        button.connectObject('button-press-event', (_actor, event) => {
            if (event.get_button() === 3) {
                this._toggleFavorite(entry.emoji);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }, this);
        button.connectObject('key-press-event', (_actor, event) => {
            switch (event.get_key_symbol()) {
                case Clutter.KEY_Return:
                case Clutter.KEY_KP_Enter:
                    this._pasteEmoji(entry);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_p:
                    this._toggleFavorite(entry.emoji);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_slash:
                    global.stage.set_key_focus(this.searchEntry);
                    return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }, this);

        return button;
    }

    _applyEmojiButtonStyle (button, compact) {
        if (this._dynamicButtonSize)
            button.set_size(this._dynamicButtonSize, this._dynamicButtonSize);
        const child = button.get_child();
        if (child)
            child.set_style(compact
                ? (this._dynamicCompactEmojiStyle || '')
                : (this._dynamicEmojiStyle || ''));
    }

    _searchText (entry) {
        return [
            entry.emoji,
            entry.name,
            entry.category,
            entry.subcategory,
            ...entry.keywords,
        ].join(' ').toLowerCase();
    }

    _selectCategory (category) {
        this._selectedCategory = category;
        this._updateCategoryButtons();
        this._queueEmojiFilter(this.searchEntry.get_text());
    }

    _updateCategoryButtons () {
        for (const [category, button] of this._categoryButtons) {
            button.set_style_class_name(category === this._selectedCategory
                ? 'emoji-category-button emoji-category-button-selected'
                : 'emoji-category-button');
        }
    }

    _queueEmojiFilter (query) {
        if (this._searchTimeoutId)
            clearTimeout(this._searchTimeoutId);

        this._searchTimeoutId = setTimeout(() => {
            this._searchTimeoutId = null;
            this._renderEmojiResults(query);
        }, SEARCH_DEBOUNCE_MS);
    }

    _renderEmojiResults (query) {
        const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const source = terms.length > 0
            ? EMOJI_DATA
            : EMOJI_DATA.filter(entry => entry.category === this._selectedCategory);
        const results = [];

        for (const entry of source) {
            const searchText = entry._searchText || this._searchText(entry);
            entry._searchText = searchText;
            if (terms.every(term => searchText.includes(term))) {
                results.push(entry);
                if (results.length >= this.visibleEmojiLimit)
                    break;
            }
        }

        const title = terms.length > 0
            ? _('Search Results')
            : this._selectedCategory;
        this.allLabel.label.set_text(title);

        this._visibleEmojiButtonsList = [];
        this.allGrid.destroy_all_children();

        if (results.length === 0) {
            this.allGrid.add_child(new St.Label({
                text: _('No emoji found'),
                style_class: 'emoji-empty-label',
            }));
            return;
        }

        this._appendEmojiRows(this.allGrid, results, false);
        this._visibleEmojiButtonsList = this._collectGridButtons(this.allGrid);
    }

    _visibleEmojiButtons () {
        return this._visibleEmojiButtonsList;
    }

    _collectGridButtons (grid) {
        const buttons = [];
        for (const row of grid.get_children()) {
            if (typeof row.get_children !== 'function')
                continue;
            buttons.push(...row.get_children());
        }
        return buttons;
    }

    _toggleFavorite (emoji) {
        const favorites = [...this.favorites];
        const index = favorites.indexOf(emoji);
        if (index >= 0)
            favorites.splice(index, 1);
        else
            favorites.unshift(emoji);

        this.extension.settings.set_strv(PrefsFields.FAVORITES, favorites);
    }

    _recordRecent (emoji) {
        const recents = [emoji, ...this.recents.filter(item => item !== emoji)]
            .slice(0, this.recentLimit);
        this.extension.settings.set_strv(PrefsFields.RECENTS, recents);
    }

    async _pasteEmoji (entry) {
        this._recordRecent(entry.emoji);

        if (this.menu.isOpen)
            this.menu.close();

        // Clipboard access is limited to explicit emoji selection so the
        // focused app can receive the emoji through the normal paste shortcut.
        St.Clipboard.get_default().set_text(CLIPBOARD_TYPE, entry.emoji);

        this._setTimeout(() => {
            this._sendPasteKeys();
        }, 80);
    }

    _sendPasteKeys () {
        if (this.keyboard.purpose === Clutter.InputContentPurpose.TERMINAL) {
            this.keyboard.press(Clutter.KEY_Control_L);
            this.keyboard.press(Clutter.KEY_Shift_L);
            this.keyboard.press(Clutter.KEY_Insert);
            this.keyboard.release(Clutter.KEY_Insert);
            this.keyboard.release(Clutter.KEY_Shift_L);
            this.keyboard.release(Clutter.KEY_Control_L);
            return;
        }

        this.keyboard.press(Clutter.KEY_Shift_L);
        this.keyboard.press(Clutter.KEY_Insert);
        this.keyboard.release(Clutter.KEY_Insert);
        this.keyboard.release(Clutter.KEY_Shift_L);
    }

    _setTimeout (callback, delay) {
        const id = setTimeout(() => {
            this._pasteTimeouts = this._pasteTimeouts.filter(item => item !== id);
            callback();
        }, delay);
        this._pasteTimeouts.push(id);
    }

    _bindShortcuts () {
        this._unbindShortcuts();
        this._bindShortcut(PrefsFields.BINDING_TOGGLE_PICKER, this._toggleMenu);
    }

    _unbindShortcuts () {
        this._shortcutsBindingIds.forEach(id => Main.wm.removeKeybinding(id));
        this._shortcutsBindingIds = [];
    }

    _bindShortcut (name, cb) {
        Main.wm.addKeybinding(
            name,
            this.extension.settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            cb.bind(this)
        );
        this._shortcutsBindingIds.push(name);
    }

    _toggleMenu () {
        if (!this.menu.isOpen && this.openAtCursor) {
            const [x, y] = global.get_pointer();
            this._positionCursorActorForMenu(x, y);
            this.menu.sourceActor = this._cursorActor;
        }
        this.menu.toggle();
    }

    _positionCursorActorForMenu (pointerX, pointerY) {
        const monitor = this._monitorForPoint(pointerX, pointerY);
        if (!monitor) {
            this._cursorActor.set_position(pointerX, pointerY);
            return;
        }

        const margin = 12;
        const scale = this.uiScale / 100;
        const menuWidth = Math.round(this.popupWidth + 36);
        const dynamicRowsHeight = (this.showFavorites && this.favorites.length > 0 ? 62 * scale : 0) +
            (this.showRecents && this.recents.length > 0 ? 62 * scale : 0);
        const menuHeight = Math.round((390 + 190) * scale + dynamicRowsHeight);
        const left = monitor.x + margin;
        const top = monitor.y + margin;
        const right = monitor.x + monitor.width - margin;
        const bottom = monitor.y + monitor.height - margin;

        let x = pointerX;
        let y = pointerY;

        if (x + menuWidth > right)
            x = Math.max(left, pointerX - menuWidth);
        if (x < left)
            x = left;

        if (y + menuHeight > bottom)
            y = Math.max(top, pointerY - menuHeight);
        if (y < top)
            y = top;

        this._cursorActor.set_position(x, y);
    }

    _monitorForPoint (x, y) {
        for (const monitor of Main.layoutManager.monitors) {
            if (x >= monitor.x && x < monitor.x + monitor.width &&
                y >= monitor.y && y < monitor.y + monitor.height) {
                return monitor;
            }
        }

        return Main.layoutManager.primaryMonitor;
    }
});
