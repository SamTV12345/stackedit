import Mousetrap from 'mousetrap';
import {getStore} from '../../store/index.js';
import editorSvc from '../../services/editorSvc.js';
import syncSvc from '../../services/syncSvc.js';

// Skip shortcuts if modal is open or editor is hidden
Mousetrap.prototype.stopCallback = () => getStore().getters['modal/config'] || !getStore().getters['content/isCurrentEditable'];

const pagedownHandler = name => () => {
  editorSvc.pagedownEditor.uiManager.doClick(name);
  return true;
};

const findReplaceOpener = type => () => {
  getStore().dispatch('findReplace/open', {
    type,
    findText: editorSvc.clEditor.selectionMgr.hasFocus() &&
      editorSvc.clEditor.selectionMgr.getSelectedText(),
  });
  return true;
};

const methods = {
  bold: pagedownHandler('bold'),
  italic: pagedownHandler('italic'),
  strikethrough: pagedownHandler('strikethrough'),
  link: pagedownHandler('link'),
  quote: pagedownHandler('quote'),
  code: pagedownHandler('code'),
  image: pagedownHandler('image'),
  olist: pagedownHandler('olist'),
  ulist: pagedownHandler('ulist'),
  clist: pagedownHandler('clist'),
  heading: pagedownHandler('heading'),
  hr: pagedownHandler('hr'),
  sync() {
    if (syncSvc.isSyncPossible()) {
      syncSvc.requestSync();
    }
    return true;
  },
  find: findReplaceOpener('find'),
  replace: findReplaceOpener('replace'),
  expand(param1, param2) {
    const text = `${param1 || ''}`;
    const replacement = `${param2 || ''}`;
    if (text && replacement) {
      setTimeout(() => {
        const { selectionMgr } = editorSvc.clEditor;
        let offset = selectionMgr.selectionStart;
        if (offset === selectionMgr.selectionEnd) {
          const range = selectionMgr.createRange(offset - text.length, offset);
          if (`${range}` === text) {
            range.deleteContents();
            range.insertNode(document.createTextNode(replacement));
            offset = (offset - text.length) + replacement.length;
            selectionMgr.setSelectionStartEnd(offset, offset);
            selectionMgr.updateCursorCoordinates(true);
          }
        }
      }, 1);
    }
  },
};

getStore().watch(
  () => getStore().getters['data/computedSettings'],
  (computedSettings) => {
    Mousetrap.reset();

    Object.entries(computedSettings.shortcuts).forEach(([key, shortcut]) => {
      if (shortcut) {
        const method = `${shortcut.method || shortcut}`;
        let params = shortcut.params || [];
        if (!Array.isArray(params)) {
          params = [params];
        }
        if (Object.prototype.hasOwnProperty.call(methods, method)) {
          try {
            Mousetrap.bind(`${key}`, () => !methods[method].apply(null, params));
          } catch (e) {
            // Ignore
          }
        }
      }
    });
  }, {
    immediate: true,
  },
);
