import { getStore } from '../store/index.js';
import utils from './utils.js';
import constants from '../data/constants.js';
import badgeSvc from './badgeSvc.js';

const forbiddenFolderNameMatcher = /^\.stackedit-data$|^\.stackedit-trash$|\.md$|\.sync$|\.publish$/;

export default {

  /**
   * Create a file in the store with the specified fields.
   */
  async createFile({
    name,
    parentId,
    text,
    properties,
    discussions,
    comments,
  } = {}, background = false) {
    const id = utils.uid();
    const item = {
      id,
      name: utils.sanitizeFilename(name),
      parentId: parentId || null,
    };
    const content = {
      id: `${id}/content`,
      text: utils.sanitizeText(text || getStore().getters['data/computedSettings'].newFileContent),
      properties: utils
        .sanitizeText(properties || getStore().getters['data/computedSettings'].newFileProperties),
      discussions: discussions || {},
      comments: comments || {},
    };
    const workspaceUniquePaths = getStore().getters['workspace/currentWorkspaceHasUniquePaths'];

    // Show warning dialogs
    if (!background) {
      // If name is being stripped
      if (item.name !== constants.defaultName && item.name !== name) {
        await getStore().dispatch('modal/open', {
          type: 'stripName',
          item,
        });
      }

      // Check if there is already a file with that path
      if (workspaceUniquePaths) {
        const parentPath = getStore().getters.pathsByItemId[item.parentId] || '';
        const path = parentPath + item.name;
        if (getStore().getters.itemsByPath[path]) {
          await getStore().dispatch('modal/open', {
            type: 'pathConflict',
            item,
          });
        }
      }
    }

    // Save file and content in the store
    getStore().commit('content/setItem', content);
    getStore().commit('file/setItem', item);
    if (workspaceUniquePaths) {
      this.makePathUnique(id);
    }

    // Return the new file item
    return getStore().state.file.itemsById[id];
  },

  /**
   * Make sanity checks and then create/update the folder/file in the store.
   */
  async storeItem(item) {
    const id = item.id || utils.uid();
    const sanitizedName = utils.sanitizeFilename(item.name);

    if (item.type === 'folder' && forbiddenFolderNameMatcher.exec(sanitizedName)) {
      await getStore().dispatch('modal/open', {
        type: 'unauthorizedName',
        item,
      });
      throw new Error('Unauthorized name.');
    }

    // Show warning dialogs
    // If name has been stripped
    if (sanitizedName !== constants.defaultName && sanitizedName !== item.name) {
      await getStore().dispatch('modal/open', {
        type: 'stripName',
        item,
      });
    }

    // Check if there is a path conflict
    if (getStore().getters['workspace/currentWorkspaceHasUniquePaths']) {
      const parentPath = getStore().getters.pathsByItemId[item.parentId] || '';
      const path = parentPath + sanitizedName;
      const items = getStore().getters.itemsByPath[path] || [];
      if (items.some(itemWithSamePath => itemWithSamePath.id !== id)) {
        await getStore().dispatch('modal/open', {
          type: 'pathConflict',
          item,
        });
      }
    }

    return this.setOrPatchItem({
      ...item,
      id,
    });
  },

  /**
   * Create/update the folder/file in the store and make sure its path is unique.
   */
  setOrPatchItem(patch) {
    const item = {
      ...getStore().getters.allItemsById[patch.id] || patch,
    };
    if (!item.id) {
      return null;
    }

    if (patch.parentId !== undefined) {
      item.parentId = patch.parentId || null;
    }
    if (patch.name) {
      const sanitizedName = utils.sanitizeFilename(patch.name);
      if (item.type !== 'folder' || !forbiddenFolderNameMatcher.exec(sanitizedName)) {
        item.name = sanitizedName;
      }
    }

    // Save item in the store
    getStore().commit(`${item.type}/setItem`, item);

    // Remove circular reference
    this.removeCircularReference(item);

    // Ensure path uniqueness
    if (getStore().getters['workspace/currentWorkspaceHasUniquePaths']) {
      this.makePathUnique(item.id);
    }

    return getStore().getters.allItemsById[item.id];
  },

  /**
   * Delete a file in the store and all its related items.
   */
  deleteFile(fileId) {
    // Delete the file
    getStore().commit('file/deleteItem', fileId);
    // Delete the content
    getStore().commit('content/deleteItem', `${fileId}/content`);
    // Delete the syncedContent
    getStore().commit('syncedContent/deleteItem', `${fileId}/syncedContent`);
    // Delete the contentState
    getStore().commit('contentState/deleteItem', `${fileId}/contentState`);
    // Delete sync locations
    (getStore().getters['syncLocation/groupedByFileId'][fileId] || [])
      .forEach(item => getStore().commit('syncLocation/deleteItem', item.id));
    // Delete publish locations
    (getStore().getters['publishLocation/groupedByFileId'][fileId] || [])
      .forEach(item => getStore().commit('publishLocation/deleteItem', item.id));
  },

  /**
   * Sanitize the whole workspace.
   */
  sanitizeWorkspace(idsToKeep) {
    // Detect and remove circular references for all folders.
    getStore().getters['folder/items'].forEach(folder => this.removeCircularReference(folder));

    this.ensureUniquePaths(idsToKeep);
    this.ensureUniqueLocations(idsToKeep);
  },

  /**
   * Detect and remove circular reference for an item.
   */
  removeCircularReference(item) {
    const foldersById = getStore().state.folder.itemsById;
    for (
      let parentFolder = foldersById[item.parentId];
      parentFolder;
      parentFolder = foldersById[parentFolder.parentId]
    ) {
      if (parentFolder.id === item.id) {
        getStore().commit('folder/patchItem', {
          id: item.id,
          parentId: null,
        });
        break;
      }
    }
  },

  /**
   * Ensure two files/folders don't have the same path if the workspace doesn't allow it.
   */
  ensureUniquePaths(idsToKeep = {}) {
    if (getStore().getters['workspace/currentWorkspaceHasUniquePaths']) {
      if (Object.keys(getStore().getters.pathsByItemId)
        .some(id => !idsToKeep[id] && this.makePathUnique(id))
      ) {
        // Just changed one item path, restart
        this.ensureUniquePaths(idsToKeep);
      }
    }
  },

  /**
   * Return false if the file/folder path is unique.
   * Add a prefix to its name and return true otherwise.
   */
  makePathUnique(id) {
    const { itemsByPath, allItemsById, pathsByItemId } = getStore().getters;
    const item = allItemsById[id];
    if (!item) {
      return false;
    }
    let path = pathsByItemId[id];
    if (itemsByPath[path].length === 1) {
      return false;
    }
    const isFolder = item.type === 'folder';
    if (isFolder) {
      // Remove trailing slash
      path = path.slice(0, -1);
    }
    for (let suffix = 1; ; suffix += 1) {
      let pathWithSuffix = `${path}.${suffix}`;
      if (isFolder) {
        pathWithSuffix += '/';
      }
      if (!itemsByPath[pathWithSuffix]) {
        getStore().commit(`${item.type}/patchItem`, {
          id: item.id,
          name: `${item.name}.${suffix}`,
        });
        return true;
      }
    }
  },

  addSyncLocation(location) {
    getStore().commit('syncLocation/setItem', {
      ...location,
      id: utils.uid(),
    });

    // Sanitize the workspace
    this.ensureUniqueLocations();

    if (Object.keys(getStore().getters['syncLocation/currentWithWorkspaceSyncLocation']).length > 1) {
      badgeSvc.addBadge('syncMultipleLocations');
    }
  },

  addPublishLocation(location) {
    getStore().commit('publishLocation/setItem', {
      ...location,
      id: utils.uid(),
    });

    // Sanitize the workspace
    this.ensureUniqueLocations();

    if (Object.keys(getStore().getters['publishLocation/current']).length > 1) {
      badgeSvc.addBadge('publishMultipleLocations');
    }
  },

  /**
   * Ensure two sync/publish locations of the same file don't have the same hash.
   */
  ensureUniqueLocations(idsToKeep = {}) {
    ['syncLocation', 'publishLocation'].forEach((type) => {
      getStore().getters[`${type}/items`].forEach((item) => {
        if (!idsToKeep[item.id]
          && getStore().getters[`${type}/groupedByFileIdAndHash`][item.fileId][item.hash].length > 1
        ) {
          getStore().commit(`${item.type}/deleteItem`, item.id);
        }
      });
    });
  },

  /**
   * Drop the database and clean the localStorage for the specified workspaceId.
   */
  async removeWorkspace(id) {
    // Remove from the store first as workspace tabs will reload.
    // Workspace deletion will be persisted as soon as possible
    // by the store.getters['data/workspaces'] watcher in localDbSvc.
    getStore().dispatch('workspace/removeWorkspace', id);

    // Drop the database
    await new Promise((resolve) => {
      const dbName = utils.getDbName(id);
      const request = indexedDB.deleteDatabase(dbName);
      request.onerror = resolve; // Ignore errors
      request.onsuccess = resolve;
    });

    // Clean the local storage
    localStorage.removeItem(`${id}/lastSyncActivity`);
    localStorage.removeItem(`${id}/lastWindowFocus`);
  },
};
