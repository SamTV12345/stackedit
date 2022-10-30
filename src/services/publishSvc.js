import localDbSvc from './localDbSvc.js';
import { getStore } from '../store/index.js';
import utils from './utils.js';
import networkSvc from './networkSvc.js';
import exportSvc from './exportSvc.js';
import providerRegistry from './providers/common/providerRegistry.js';
import workspaceSvc from './workspaceSvc.js';
import badgeSvc from './badgeSvc.js';

const hasCurrentFilePublishLocations = () => !!getStore().getters['publishLocation/current'].length;

const loader = type => fileId => localDbSvc.loadItem(`${fileId}/${type}`)
  // Item does not exist, create it
  .catch(() => getStore().commit(`${type}/setItem`, {
    id: `${fileId}/${type}`,
  }));
const loadContent = loader('content');

const ensureArray = (value) => {
  if (!value) {
    return [];
  }
  if (!Array.isArray(value)) {
    return `${value}`.trim().split(/\s*,\s*/);
  }
  return value;
};

const ensureString = (value, defaultValue) => {
  if (!value) {
    return defaultValue;
  }
  return `${value}`;
};

const ensureDate = (value, defaultValue) => {
  if (!value) {
    return defaultValue;
  }
  return new Date(`${value}`);
};

const publish = async (publishLocation) => {
  const { fileId } = publishLocation;
  const template = getStore().getters['data/allTemplatesById'][publishLocation.templateId];
  const html = await exportSvc.applyTemplate(fileId, template);
  const content = await localDbSvc.loadItem(`${fileId}/content`);
  const file = getStore().state.file.itemsById[fileId];
  const properties = utils.computeProperties(content.properties);
  const provider = providerRegistry.providersById[publishLocation.providerId];
  const token = provider.getToken(publishLocation);
  const metadata = {
    title: ensureString(properties.title, file.name),
    author: ensureString(properties.author),
    tags: ensureArray(properties.tags),
    categories: ensureArray(properties.categories),
    excerpt: ensureString(properties.excerpt),
    featuredImage: ensureString(properties.featuredImage),
    status: ensureString(properties.status),
    date: ensureDate(properties.date, new Date()),
  };
  return provider.publish(token, html, metadata, publishLocation);
};

const publishFile = async (fileId) => {
  let counter = 0;
  await loadContent(fileId);
  const publishLocations = [
    ...getStore().getters['publishLocation/filteredGroupedByFileId'][fileId] || [],
  ];
  try {
    await utils.awaitSequence(publishLocations, async (publishLocation) => {
      await getStore().dispatch('queue/doWithLocation', {
        location: publishLocation,
        action: async () => {
          const publishLocationToStore = await publish(publishLocation);
          try {
            // Replace publish location if modified
            if (utils.serializeObject(publishLocation) !==
              utils.serializeObject(publishLocationToStore)
            ) {
              getStore().commit('publishLocation/patchItem', publishLocationToStore);
              workspaceSvc.ensureUniqueLocations();
            }
            counter += 1;
          } catch (err) {
            if (getStore().state.offline) {
              throw err;
            }
            console.error(err); // eslint-disable-line no-console
            getStore().dispatch('notification/error', err);
          }
        },
      });
    });
    const file = getStore().state.file.itemsById[fileId];
    getStore().dispatch('notification/info', `"${file.name}" was published to ${counter} location(s).`);
  } finally {
    await localDbSvc.unloadContents();
  }
};

const requestPublish = () => {
  // No publish in light mode
  if (getStore().state.light) {
    return;
  }

  getStore().dispatch('queue/enqueuePublishRequest', async () => {
    let intervalId;
    const attempt = async () => {
      // Only start publishing when these conditions are met
      if (networkSvc.isUserActive()) {
        clearInterval(intervalId);
        if (!hasCurrentFilePublishLocations()) {
          // Cancel publish
          throw new Error('Publish not possible.');
        }
        await publishFile(getStore().getters['file/current'].id);
        badgeSvc.addBadge('triggerPublish');
      }
    };
    intervalId = utils.setInterval(() => attempt(), 1000);
    return attempt();
  });
};

const createPublishLocation = (publishLocation, featureId) => {
  const currentFile = getStore().getters['file/current'];
  publishLocation.fileId = currentFile.id;
  getStore().dispatch(
    'queue/enqueue',
    async () => {
      const publishLocationToStore = await publish(publishLocation);
      workspaceSvc.addPublishLocation(publishLocationToStore);
      getStore().dispatch('notification/info', `A new publication location was added to "${currentFile.name}".`);
      if (featureId) {
        badgeSvc.addBadge(featureId);
      }
    },
  );
};

export default {
  requestPublish,
  createPublishLocation,
};
