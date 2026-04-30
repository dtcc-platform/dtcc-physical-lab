// IMPORTANT: MapLibre CSS must be imported before app.css so our Tailwind
// overrides win the cascade.
import 'maplibre-gl/dist/maplibre-gl.css';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('missing #app mount node');

mount(App, { target });
