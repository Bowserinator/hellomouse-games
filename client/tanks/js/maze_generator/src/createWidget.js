import { Maze } from "./Maze.js";

//Node doesn't have a fetch function so we need to fix that
if (typeof window === "undefined") {
  globalThis.fetch = globalThis.fetch ?? require("node-fetch");
}

export default function createWidget(
  mazeSettings = {},
  displaySettings = mazeSettings,
  widgetSettings = mazeSettings,
) {
  mazeSettings = {
    size: mazeSettings.height || mazeSettings.ySize || 15,
    ...mazeSettings,
  };

  displaySettings = {
    displayMode: 0,
    antiAliasing: false,
    ...displaySettings,
  };

  widgetSettings = {
    paused: false,
    imageButtons: false,
    containerElement: document.getElementById("maze-widget-container") ??
      document?.getElementsByClassName("maze-widget-container")[0] ??
      document.body,
    ...widgetSettings,
  };

  let maze = new Maze(mazeSettings);

  let mazeId = maze.algorithm.constructor.name + "-" + maze.algorithm.seed;
  let widgetId = mazeId + "-widget";
  let canvasId = mazeId + "-canvas";

  const iconImageFolderURL =
    "https://x.nest.land/maze_generator@0.4.0/images/button-icons";
  const cssFileURL =
    "https://x.nest.land/maze_generator@0.4.0/widget-styles.css";

  function getButtonInnerHTML(buttonName) {
    if (widgetSettings.imageButtons) {
      return `<img 
        class="maze-widget-image maze-widget-${buttonName}-image"
        src="${iconImageFolderURL}/${buttonName}.svg" 
        alt="${buttonName}"
      />`;
    } else {
      return buttonName;
    }
  }

  let html = `
  <div class="maze-widget ${maze.algorithm.constructor.name}" id="${widgetId}">
  <canvas width="300" height="300" style="width:220px; height:220px" class="maze-widget-canvas" id="${canvasId}"></canvas>
  <div class="maze-widget-options">
    <button class="play-pause-button maze-widget-button" onClick="document.getElementById('${widgetId}').playPauseMaze()">
      ${getButtonInnerHTML(widgetSettings.paused ? "play" : "pause")}
    </button>
    <button class="step-button maze-widget-button" onClick="document.getElementById('${widgetId}').stepMaze()">
      ${getButtonInnerHTML("step")}
    </button>
    <button class="finish-button maze-widget-button" onClick="document.getElementById('${widgetId}').generateMaze()">
      ${getButtonInnerHTML("finish")}
    </button>
    <button class="restart-button maze-widget-button" onClick="document.getElementById('${widgetId}').restartMaze()">
      ${getButtonInnerHTML("restart")}
    </button>
  </div>
</div>
  `;

  widgetSettings.containerElement.innerHTML += html;

  //add css
  fetch(cssFileURL)
    .then((response) => response.text())
    .then((data) => {
      if (document.getElementById("maze-widget-css") !== undefined) {
        let styleElement = document.createElement("style");
        styleElement.innerHTML = data;
        styleElement.id = "maze-widget-css";

        document.getElementsByTagName("head")[0].appendChild(styleElement);
      }
    });

  let widget = document.getElementById(widgetId);
  displaySettings.canvas = document.getElementById(canvasId);

  widget.playPauseMaze = () => {
    widgetSettings.paused = !widgetSettings.paused;
    widget.getElementsByClassName("play-pause-button")[0].innerHTML =
      getButtonInnerHTML(widgetSettings.paused ? "play" : "pause");
  };

  widget.stepMaze = () => {
    maze.step();
    maze.display(displaySettings);
    widgetSettings.paused = true;
    widget.getElementsByClassName("play-pause-button")[0].innerHTML =
      getButtonInnerHTML("play");
  };

  widget.generateMaze = () => {
    maze.generate();
    widget.getElementsByClassName("play-pause-button")[0].disabled = true;
    widget.getElementsByClassName("step-button")[0].disabled = true;
    widget.getElementsByClassName("finish-button")[0].disabled = true;
    maze.display(displaySettings);
  };

  widget.restartMaze = () => {
    maze.reset();
    widget.getElementsByClassName("play-pause-button")[0].disabled = false;
    widget.getElementsByClassName("step-button")[0].disabled = false;
    widget.getElementsByClassName("finish-button")[0].disabled = false;
    maze.display(displaySettings);
  };

  maze.display(displaySettings);

  let updateCanvas = () => {
    setTimeout(() => {
      if (!widgetSettings.paused) {
        maze.step();
        maze.display(displaySettings);

        if (maze.algorithm.finishedGenerating) {
          widget.getElementsByClassName("play-pause-button")[0].disabled = true;
          widget.getElementsByClassName("step-button")[0].disabled = true;
          widget.getElementsByClassName("finish-button")[0].disabled = true;
        }
      }

      updateCanvas();
    }, 100);
  };

  updateCanvas();

  return maze;
}
