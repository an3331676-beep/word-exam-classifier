import './style.css';
import { createExamApp } from './app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('缺少应用容器');

createExamApp(root);
