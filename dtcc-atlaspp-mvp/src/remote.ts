import { mount } from 'svelte';
import RemoteApp from './lib/RemoteApp.svelte';
import './app.css';

mount(RemoteApp, {
  target: document.getElementById('remote')!,
});
