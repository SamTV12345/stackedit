import {getStore} from '../../store/index.js';
import gitlabHelper from './helpers/gitlabHelper.js';
import Provider from './common/Provider.js';
import utils from '../utils.js';
import userSvc from '../userSvc.js';
import gitWorkspaceSvc from '../gitWorkspaceSvc.js';
import badgeSvc from '../badgeSvc.js';

const getAbsolutePath = ({ id }) =>
  `${getStore().getters['workspace/currentWorkspace'].path || ''}${id}`;

export default new Provider({
  id: 'gitlabWorkspace',
  name: 'GitLab',
  getToken() {
    return getStore().getters['workspace/syncToken'];
  },
  getWorkspaceParams({
    serverUrl,
    projectPath,
    branch,
    path,
  }) {
    return {
      providerId: this.id,
      serverUrl,
      projectPath,
      branch,
      path,
    };
  },
  getWorkspaceLocationUrl({
    serverUrl,
    projectPath,
    branch,
    path,
  }) {
    return `${serverUrl}/${projectPath}/blob/${encodeURIComponent(branch)}/${utils.encodeUrlPath(path)}`;
  },
  getSyncDataUrl({ id }) {
    const { projectPath, branch } = getStore().getters['workspace/currentWorkspace'];
    const { serverUrl } = this.getToken();
    return `${serverUrl}/${projectPath}/blob/${encodeURIComponent(branch)}/${utils.encodeUrlPath(getAbsolutePath({ id }))}`;
  },
  getSyncDataDescription({ id }) {
    return getAbsolutePath({ id });
  },
  async initWorkspace() {
    const { serverUrl, branch } = utils.queryParams;
    const workspaceParams = this.getWorkspaceParams({ serverUrl, branch });
    if (!branch) {
      workspaceParams.branch = 'master';
    }

    // Extract project path param
    const projectPath = (utils.queryParams.projectPath || '')
      .trim()
      .replace(/^\/*/, '') // Remove leading `/`
      .replace(/\/*$/, ''); // Remove trailing `/`
    workspaceParams.projectPath = projectPath;

    // Extract path param
    const path = (utils.queryParams.path || '')
      .trim()
      .replace(/^\/*/, '') // Remove leading `/`
      .replace(/\/*$/, '/'); // Add trailing `/`
    if (path !== '/') {
      workspaceParams.path = path;
    }

    const workspaceId = utils.makeWorkspaceId(workspaceParams);
    const workspace = getStore().getters['workspace/workspacesById'][workspaceId];

    // See if we already have a token
    const sub = workspace ? workspace.sub : utils.queryParams.sub;
    let token = getStore().getters['data/gitlabTokensBySub'][sub];
    if (!token) {
      const { applicationId } = await getStore().dispatch('modal/open', {
        type: 'gitlabAccount',
        forceServerUrl: serverUrl,
      });
      token = await gitlabHelper.addAccount(serverUrl, applicationId, sub);
    }

    if (!workspace) {
      const projectId = await gitlabHelper.getProjectId(token, workspaceParams);
      const pathEntries = (path || '').split('/');
      const projectPathEntries = (projectPath || '').split('/');
      const name = pathEntries[pathEntries.length - 2] // path ends with `/`
        || projectPathEntries[projectPathEntries.length - 1];
      getStore().dispatch('workspace/patchWorkspacesById', {
        [workspaceId]: {
          ...workspaceParams,
          projectId,
          id: workspaceId,
          sub: token.sub,
          name,
        },
      });
    }

    badgeSvc.addBadge('addGitlabWorkspace');
    return getStore().getters['workspace/workspacesById'][workspaceId];
  },
  getChanges() {
    return gitlabHelper.getTree({
      ...getStore().getters['workspace/currentWorkspace'],
      token: this.getToken(),
    });
  },
  prepareChanges(tree) {
    return gitWorkspaceSvc.makeChanges(tree.map(entry => ({
      ...entry,
      sha: entry.id,
    })));
  },
  async saveWorkspaceItem({ item }) {
    const syncData = {
      id: getStore().getters.gitPathsByItemId[item.id],
      type: item.type,
      hash: item.hash,
    };

    // Files and folders are not in git, only contents
    if (item.type === 'file' || item.type === 'folder') {
      return { syncData };
    }

    // locations are stored as paths, so we upload an empty file
    const syncToken = getStore().getters['workspace/syncToken'];
    await gitlabHelper.uploadFile({
      ...getStore().getters['workspace/currentWorkspace'],
      token: syncToken,
      path: getAbsolutePath(syncData),
      content: '',
      sha: gitWorkspaceSvc.shaByPath[syncData.id],
    });

    // Return sync data to save
    return { syncData };
  },
  async removeWorkspaceItem({ syncData }) {
    if (gitWorkspaceSvc.shaByPath[syncData.id]) {
      const syncToken = getStore().getters['workspace/syncToken'];
      await gitlabHelper.removeFile({
        ...getStore().getters['workspace/currentWorkspace'],
        token: syncToken,
        path: getAbsolutePath(syncData),
        sha: gitWorkspaceSvc.shaByPath[syncData.id],
      });
    }
  },
  async downloadWorkspaceContent({
    token,
    contentId,
    contentSyncData,
    fileSyncData,
  }) {
    const { sha, data } = await gitlabHelper.downloadFile({
      ...getStore().getters['workspace/currentWorkspace'],
      token,
      path: getAbsolutePath(fileSyncData),
    });
    gitWorkspaceSvc.shaByPath[fileSyncData.id] = sha;
    const content = Provider.parseContent(data, contentId);
    return {
      content,
      contentSyncData: {
        ...contentSyncData,
        hash: content.hash,
        sha,
      },
    };
  },
  async downloadWorkspaceData({ token, syncData }) {
    if (!syncData) {
      return {};
    }

    const { sha, data } = await gitlabHelper.downloadFile({
      ...getStore().getters['workspace/currentWorkspace'],
      token,
      path: getAbsolutePath(syncData),
    });
    gitWorkspaceSvc.shaByPath[syncData.id] = sha;
    const item = JSON.parse(data);
    return {
      item,
      syncData: {
        ...syncData,
        hash: item.hash,
        sha,
      },
    };
  },
  async uploadWorkspaceContent({ token, content, file }) {
    const path = getStore().getters.gitPathsByItemId[file.id];
    const absolutePath = `${getStore().getters['workspace/currentWorkspace'].path || ''}${path}`;
    const sha = gitWorkspaceSvc.shaByPath[path];
    await gitlabHelper.uploadFile({
      ...getStore().getters['workspace/currentWorkspace'],
      token,
      path: absolutePath,
      content: Provider.serializeContent(content),
      sha,
    });

    // Return new sync data
    return {
      contentSyncData: {
        id: getStore().getters.gitPathsByItemId[content.id],
        type: content.type,
        hash: content.hash,
        sha,
      },
      fileSyncData: {
        id: path,
        type: 'file',
        hash: file.hash,
      },
    };
  },
  async uploadWorkspaceData({ token, item }) {
    const path = getStore().getters.gitPathsByItemId[item.id];
    const syncData = {
      id: path,
      type: item.type,
      hash: item.hash,
    };
    const res = await gitlabHelper.uploadFile({
      ...getStore().getters['workspace/currentWorkspace'],
      token,
      path: getAbsolutePath(syncData),
      content: JSON.stringify(item),
      sha: gitWorkspaceSvc.shaByPath[path],
    });

    return {
      syncData: {
        ...syncData,
        sha: res.content.sha,
      },
    };
  },
  async listFileRevisions({ token, fileSyncDataId }) {
    const { projectId, branch } = getStore().getters['workspace/currentWorkspace'];
    const entries = await gitlabHelper.getCommits({
      token,
      projectId,
      sha: branch,
      path: getAbsolutePath({ id: fileSyncDataId }),
    });

    return entries.map((entry) => {
      const email = entry.author_email || entry.committer_email;
      const sub = `${gitlabHelper.subPrefix}:${token.serverUrl}/${email}`;
      userSvc.addUserInfo({
        id: sub,
        name: entry.author_name || entry.committer_name,
        imageUrl: '', // No way to get user's avatar url...
      });
      const date = entry.authored_date || entry.committed_date || 1;
      return {
        id: entry.id,
        sub,
        created: date ? new Date(date).getTime() : 1,
      };
    });
  },
  async loadFileRevision() {
    // Revisions are already loaded
    return false;
  },
  async getFileRevisionContent({
    token,
    contentId,
    fileSyncDataId,
    revisionId,
  }) {
    const { data } = await gitlabHelper.downloadFile({
      ...getStore().getters['workspace/currentWorkspace'],
      token,
      branch: revisionId,
      path: getAbsolutePath({ id: fileSyncDataId }),
    });
    return Provider.parseContent(data, contentId);
  },
});
