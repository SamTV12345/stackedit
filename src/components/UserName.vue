<template>
  <span class="user-name">{{name}}</span>
</template>

<script>
import userSvc from '../services/userSvc.js';
import {getStore} from '../store/index.js';

export default {
  props: ['userId'],
  computed: {
    sanitizedUserId() {
      return userSvc.sanitizeUserId(this.userId);
    },
    name() {
      const userInfo = getStore().state.userInfo.itemsById[this.sanitizedUserId];
      return userInfo ? userInfo.name : 'Someone';
    },
  },
  watch: {
    sanitizedUserId: {
      handler: sanitizedUserId => userSvc.addUserId(sanitizedUserId),
      immediate: true,
    },
  },
};
</script>
