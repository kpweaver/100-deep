import './styles.css';
import { App } from './app.ts';

const app = new App(document.getElementById('app')!);
app.start();
// Exposed for debugging in the browser console (read-only state mirror)
(window as unknown as { thang: App }).thang = app;
