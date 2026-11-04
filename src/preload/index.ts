import { contextBridge, ipcRenderer } from 'electron';

import { PRACTICE_PLAYER_API_KEY } from '@core/contracts/api';

import { createPracticePlayerApi } from './api';

/**
 * The only module in the application allowed to touch `ipcRenderer`.
 * The exposed surface is a small, typed object with no generic IPC access.
 */
const api = createPracticePlayerApi((channel, ...args) => ipcRenderer.invoke(channel, ...args));

contextBridge.exposeInMainWorld(PRACTICE_PLAYER_API_KEY, api);
