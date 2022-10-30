import {getStore} from '../store/index.js';
import workspaceSvc from './workspaceSvc.js';
import badgeSvc from './badgeSvc.js';

export default {
  newItem(isFolder = false) {
    let parentId = getStore().getters['explorer/selectedNodeFolder'].item.id;
    if (parentId === 'trash' // Not allowed to create new items in the trash
      || (isFolder && parentId === 'temp') // Not allowed to create new folders in the temp folder
    ) {
      parentId = null;
    }
    getStore().dispatch('explorer/openNode', parentId);
    getStore().commit('explorer/setNewItem', {
      type: isFolder ? 'folder' : 'file',
      parentId,
    });
  },
  async deleteItem() {
    const selectedNode = getStore().getters['explorer/selectedNode'];
    if (selectedNode.isNil) {
      return;
    }

    if (selectedNode.isTrash || selectedNode.item.parentId === 'trash') {
      try {
        await getStore().dispatch('modal/open', 'trashDeletion');
      } catch (e) {
        // Cancel
      }
      return;
    }

    // See if we have a confirmation dialog to show
    let moveToTrash = true;
    try {
      if (selectedNode.isTemp) {
        await getStore().dispatch('modal/open', 'tempFolderDeletion');
        moveToTrash = false;
      } else if (selectedNode.item.parentId === 'temp') {
        await getStore().dispatch('modal/open', {
          type: 'tempFileDeletion',
          item: selectedNode.item,
        });
        moveToTrash = false;
      } else if (selectedNode.isFolder) {
        await store().dispatch('modal/open', {
          type: 'folderDeletion',
          item: selectedNode.item,
        });
      }
    } catch (e) {
      return; // cancel
    }

    const deleteFile = (id) => {
      if (moveToTrash) {
        workspaceSvc.setOrPatchItem({
          id,
          parentId: 'trash',
        });
      } else {
        workspaceSvc.deleteFile(id);
      }
    };

    if (selectedNode === getStore().getters['explorer/selectedNode']) {
      const currentFileId = getStore().getters['file/current'].id;
      let doClose = selectedNode.item.id === currentFileId;
      if (selectedNode.isFolder) {
        const recursiveDelete = (folderNode) => {
          folderNode.folders.forEach(recursiveDelete);
          folderNode.files.forEach((fileNode) => {
            doClose = doClose || fileNode.item.id === currentFileId;
            deleteFile(fileNode.item.id);
          });
          getStore().commit('folder/deleteItem', folderNode.item.id);
        };
        recursiveDelete(selectedNode);
        badgeSvc.addBadge('removeFolder');
      } else {
        deleteFile(selectedNode.item.id);
        badgeSvc.addBadge('removeFile');
      }
      if (doClose) {
        // Close the current file by opening the last opened, not deleted one
        getStore().getters['data/lastOpenedIds'].some((id) => {
          const file = getStore().state.file.itemsById[id];
          if (file.parentId === 'trash') {
            return false;
          }
          getStore().commit('file/setCurrentId', id);
          return true;
        });
      }
    }
  },
};
