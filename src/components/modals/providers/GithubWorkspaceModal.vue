<template>
  <modal-inner aria-label="Synchronize with GitHub">
    <div class="modal__content">
      <div class="modal__image">
        <icon-provider provider-id="github"></icon-provider>
      </div>
      <p>Create a workspace synced with a <b>GitHub</b> repository folder.</p>
      <form-entry label="Repository URL" error="repoUrl">
        <input slot="field" class="textfield" type="text" v-model.trim="repoUrl" @keydown.enter="resolve()">
        <div class="form-entry__info">
          <b>Example:</b> https://github.com/owner/my-repo
        </div>
      </form-entry>
      <form-entry label="Folder path" info="optional">
        <input slot="field" class="textfield" type="text" v-model.trim="path" @keydown.enter="resolve()">
        <div class="form-entry__info">
          If not supplied, the root folder will be used.
        </div>
      </form-entry>
      <form-entry label="Branch" info="optional">
        <input slot="field" class="textfield" type="text" v-model.trim="branch" @keydown.enter="resolve()">
        <div class="form-entry__info">
          If not supplied, the <code>master</code> branch will be used.
        </div>
      </form-entry>
    </div>
    <div class="modal__button-bar">
      <button class="button" @click="config.reject()">Cancel</button>
      <button class="button button--resolve" @click="resolve()">Ok</button>
    </div>
  </modal-inner>
</template>

<script>
import utils from '../../../services/utils.js';
import modalTemplate from '../common/modalTemplate.js';

export default modalTemplate({
  data: () => ({
    branch: '',
    path: '',
  }),
  computedLocalSettings: {
    repoUrl: 'githubWorkspaceRepoUrl',
  },
  methods: {
    resolve() {
      const parsedRepo = utils.parseGithubRepoUrl(this.repoUrl);
      if (!parsedRepo) {
        this.setError('repoUrl');
      } else {
        const path = this.path && this.path.replace(/^\//, '');
        const url = utils.addQueryParams('app', {
          ...parsedRepo,
          providerId: 'githubWorkspace',
          branch: this.branch || 'master',
          path: path || undefined,
        }, true);
        this.config.resolve();
        window.open(url);
      }
    },
  },
});
</script>
