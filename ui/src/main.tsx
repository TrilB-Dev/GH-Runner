import React from "react";
import ReactDOM from "react-dom/client";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import "@crestapps/bootstrap-select/dist/css/bootstrap-select.min.css";

import { App } from './App';

const applyBootstrapTheme = () => {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  const updateTheme = () => {
    document.documentElement.dataset.bsTheme = prefersDark.matches ? 'dark' : 'light';
    document.documentElement.classList.add('dockerDesktopTheme');
  };

  updateTheme();
  if (prefersDark.addEventListener) {
    prefersDark.addEventListener('change', updateTheme);
  } else {
    prefersDark.addListener(updateTheme);
  }
};

applyBootstrapTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
