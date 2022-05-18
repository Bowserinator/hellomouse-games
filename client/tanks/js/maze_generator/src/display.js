import { directions } from "./directions.js";

export default function display({
  maze,
  canvas = document.getElementsByTagName("canvas")[0],
  asLine = false,
  cellSize = Math.min(
    canvas.width / maze.algorithm.width,
    canvas.height / maze.algorithm.height,
  ) *
    0.9,
  backgroundColor = "#FFF",
  mainColor = "#000",
  colorScheme = "rainbow",
  lineThickness = 0.35,
  antiAliasing = false,
  coloringMode = "normal",
  showSolution = false,
  solutionColor = "#F00",
  distanceFrom = maze.algorithm.start,
  removeWallsAtEntranceAndExit = true,
  lineCap = "square",
}) {
  if (!canvas) {
    console.error("Tried to display maze without a canvas");
    return false;
  }

  //remove the walls at the entrance and exit if it is set to that
  let entranceWallBefore;
  let exitWallBefore;
  if (removeWallsAtEntranceAndExit) {
    //if the entrance wall is a valid direction
    if (directions.indexOf(maze.algorithm.entrance.direction) !== -1) {
      entranceWallBefore = maze.algorithm
        .walls[maze.algorithm.entrance.y][maze.algorithm.entrance.x][
        maze.algorithm.entrance.direction
      ];
      maze.algorithm
        .walls[maze.algorithm.entrance.y][maze.algorithm.entrance.x][
        maze.algorithm.entrance.direction
      ] = false;
    }

    //if the exit wall is a valid direction
    if (directions.indexOf(maze.algorithm.exit.direction) !== -1) {
      exitWallBefore = maze.algorithm
        .walls[maze.algorithm.exit.y][maze.algorithm.exit.x][
        maze.algorithm.exit.direction
      ];
      maze.algorithm
        .walls[maze.algorithm.exit.y][maze.algorithm.exit.x][
        maze.algorithm.exit.direction
      ] = false;
    }
  }

  let ctx = canvas.getContext("2d");

  ctx.imageSmoothingEnabled = antiAliasing;
  ctx.lineCap = lineCap;

  if (typeof colorScheme === "string") {
    colorScheme = colorScheme.toLowerCase();

    switch (colorScheme) {
      case "rainbow":
        // deno-fmt-ignore
        colorScheme = ["#6d3fa9", "#7d3eaf", "#8d3db2", "#9e3cb3", "#ae3cb1", "#bf3cae", "#ce3da9", "#dc3fa1", "#e94298", "#f5468e", "#fe4b82", "#ff5176", "#ff5969", "#ff625d", "#ff6c51", "#ff7746", "#ff833d", "#fe8f35", "#f69c30", "#ecaa2e", "#e2b72e", "#d6c431", "#cbd037", "#c1db40", "#b7e64c", "#afef5a", "#9bf257", "#88f457", "#75f659", "#62f65f", "#52f566", "#43f370", "#36f07c", "#2bec88", "#23e695", "#1ddea3", "#1ad6b0", "#19ccbc", "#1ac1c7", "#1eb6d0", "#23aad8", "#2a9edd", "#3192e0", "#3a85e1", "#4379df", "#4c6edb", "#5463d5", "#5c59cc", "#634fc2", "#6947b6"];
        break;

      //grayscale

      default:
        colorScheme = ["#FFFFFF", "#000008"];
    }
  }

  if (typeof coloringMode === "string") {
    coloringMode = coloringMode.toLowerCase();
  }

  let {
    distances,
    maxDistance,
  } = coloringMode === "distance"
    ? maze.getDistances(distanceFrom)
    : { distances: null, maxDistance: null };

  //slider element stores 0 as a string so we need to convert it back to a number
  lineThickness = Number(lineThickness);

  //clear the background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  //center the maze
  ctx.setTransform(
    1,
    0,
    0,
    1,
    canvas.width / 2 - maze.algorithm.width / 2 * cellSize,
    canvas.height / 2 - maze.algorithm.height / 2 * cellSize,
  );

  ctx.strokeStyle = mainColor;
  ctx.lineWidth = lineThickness * cellSize;

  if (!asLine) { // draw the walls
    for (let y = 0; y < maze.algorithm.height; y++) {
      for (let x = 0; x < maze.algorithm.width; x++) {
        ctx.fillStyle = getCellColor({
          x,
          y,
        });

        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }

    for (let y = 0; y < maze.algorithm.height; y++) {
      for (let x = 0; x < maze.algorithm.width; x++) {
        ctx.strokeStyle = mainColor;

        if (maze.algorithm.walls[y][x].W) {
          line(x * cellSize, y * cellSize, x * cellSize, (y + 1) * cellSize);
        }
        if (maze.algorithm.walls[y][x].N) {
          line(x * cellSize, y * cellSize, (x + 1) * cellSize, y * cellSize);
        }
        if (maze.algorithm.walls[y][x].E && x === maze.algorithm.width - 1) {
          line(
            (x + 1) * cellSize,
            y * cellSize,
            (x + 1) * cellSize,
            (y + 1) * cellSize,
          );
        }
        if (maze.algorithm.walls[y][x].S && y === maze.algorithm.height - 1) {
          line(
            x * cellSize,
            (y + 1) * cellSize,
            (x + 1) * cellSize,
            (y + 1) * cellSize,
          );
        }
      }
    }
  } else { // display paths as line
    ctx.translate(cellSize / 2, cellSize / 2);

    for (let y = 0; y < maze.algorithm.height; y++) {
      for (let x = 0; x < maze.algorithm.width; x++) {
        ctx.strokeStyle = getCellColor({
          x,
          y,
        });

        if (!maze.algorithm.walls[y][x].W) {
          line(x * cellSize, y * cellSize, (x - 0.5) * cellSize, y * cellSize);
        }
        if (!maze.algorithm.walls[y][x].N) {
          line(x * cellSize, y * cellSize, x * cellSize, (y - 0.5) * cellSize);
        }
        if (!maze.algorithm.walls[y][x].E) {
          line(x * cellSize, y * cellSize, (x + 0.5) * cellSize, y * cellSize);
        }
        if (!maze.algorithm.walls[y][x].S) {
          line(x * cellSize, y * cellSize, x * cellSize, (y + 0.5) * cellSize);
        }
      }
    }
  }

  if (showSolution) {
    ctx.setTransform(
      1,
      0,
      0,
      1,
      canvas.width / 2 - maze.algorithm.width / 2 * cellSize,
      canvas.height / 2 - maze.algorithm.height / 2 * cellSize,
    );

    let solution = maze.getSolution();
    ctx.strokeStyle = solutionColor;
    ctx.lineWidth = cellSize * 0.27;
    if (ctx.lineWidth < 1) ctx.lineWidth = 1;
    if (ctx.lineWidth > 10) ctx.lineWidth = 10;

    ctx.translate(cellSize / 2, cellSize / 2);
    for (let i = 0; i < solution.length - 1; i++) {
      line(
        solution[i].x * cellSize,
        solution[i].y * cellSize,
        solution[i + 1].x * cellSize,
        solution[i + 1].y * cellSize,
      );
    }
  }

  //put the walls at the entrance and exit back if they were there before
  if (removeWallsAtEntranceAndExit) {
    //re-add the entrance wall if it was taken away to begin with
    if (directions.indexOf(maze.algorithm.entrance.direction) !== -1) {
      maze.algorithm
        .walls[maze.algorithm.entrance.y][maze.algorithm.entrance.x][
        maze.algorithm.entrance.direction
      ] = entranceWallBefore;
    }

    //re-add the exit wall if it was taken away to begin with
    if (directions.indexOf(maze.algorithm.exit.direction) !== -1) {
      maze.algorithm
        .walls[maze.algorithm.exit.y][maze.algorithm.exit.x][
        maze.algorithm.exit.direction
      ] = exitWallBefore;
    }
  }

  //reset transformation matrix
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  function isUnfinishedCell(cell) {
    if (
      maze.algorithm.walls[cell.y][cell.x].N === false && cell.y > 0
    ) {
      return false;
    }
    if (
      maze.algorithm.walls[cell.y][cell.x].S === false &&
      cell.y < maze.algorithm.height - 1
    ) {
      return false;
    }
    if (
      maze.algorithm.walls[cell.y][cell.x].E === false &&
      cell.x < maze.algorithm.width - 1
    ) {
      return false;
    }
    if (
      maze.algorithm.walls[cell.y][cell.x].W === false && cell.x > 0
    ) {
      return false;
    }
    return true;
  }

  function getCellColor(cell) {
    let cellColor = asLine ? mainColor : backgroundColor;

    //highlight cells that haven't finished generating differently, depending on the display mode
    //an unfinished cell is one that has all it's walls around it
    //not used for display mode 2 (line) because it looks weird
    if (isUnfinishedCell(cell)) {
      if (!asLine) {
        cellColor = lerpBetween(backgroundColor, mainColor, 0.5);
      } else {
        cellColor = lerpBetween(backgroundColor, mainColor, 0.03);
      }
    } else {
      if (coloringMode === "distance" || coloringMode === "color by distance") {
        cellColor = interpolate(
          colorScheme,
          distances[cell.y][cell.x] / maxDistance,
        );
      } else if (coloringMode === "set" || coloringMode === "color by set") {
        if (maze.algorithm.constructor.name === "Kruskals") {
          cellColor = interpolate(
            colorScheme,
            maze.algorithm.disjointSubsets.findParent(
              maze.algorithm.getCellIndex(cell),
            ) /
              (maze.algorithm.width * maze.algorithm.height),
          );
        } else if (maze.algorithm.constructor.name === "Ellers") {
          cellColor = interpolate(
            colorScheme,
            maze.algorithm.cellSets[cell.y][cell.x] /
              (maze.algorithm.width * maze.algorithm.height),
          );
        }
      }
    }

    return cellColor;

    function interpolate(colorScheme, k = 0, repeats = 1) {
      k = k === 1 ? 1 : k * repeats % 1;

      let i = k * (colorScheme.length - 1);
      let color1 = colorScheme[Math.floor(i)];
      let color2 = colorScheme[(Math.floor(i) + 1) % colorScheme.length];
      let interpolatedColor = lerpBetween(color1, color2, i % 1);

      return interpolatedColor;
    }
  }

  function lerpBetween(color1, color2, k) {
    color1 = typeof color1 === "string" ? hexToRgb(color1) : color1;
    color2 = typeof color2 === "string" ? hexToRgb(color2) : color2;

    return rgbToHex({
      r: color1.r + (color2.r - color1.r) * k,
      g: color1.g + (color2.g - color1.g) * k,
      b: color1.b + (color2.b - color1.b) * k,
    });
  }

  //adapted from https://stackoverflow.com/questions/5623838
  function hexToRgb(hex) {
    if (typeof hex === "object") return hex;

    //e.g. #15C22F
    let sixDigitHexRegexResult = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i
      .exec(hex);

    //e.g. #1C3
    let threeDigitHexRegexResult = /^#?([a-f\d]{1})([a-f\d]{1})([a-f\d]{1})$/i
      .exec(hex);

    return (
      sixDigitHexRegexResult
        ? {
          r: parseInt(sixDigitHexRegexResult[1], 16),
          g: parseInt(sixDigitHexRegexResult[2], 16),
          b: parseInt(sixDigitHexRegexResult[3], 16),
        }
        : threeDigitHexRegexResult
        ? {
          r: parseInt(
            threeDigitHexRegexResult[1] + threeDigitHexRegexResult[1],
            16,
          ),
          g: parseInt(
            threeDigitHexRegexResult[2] + threeDigitHexRegexResult[2],
            16,
          ),
          b: parseInt(
            threeDigitHexRegexResult[3] + threeDigitHexRegexResult[3],
            16,
          ),
        }
        : null
    );
  }

  function rgbToHex(rgbObject) {
    return "#" + componentToHex(rgbObject.r) + componentToHex(rgbObject.g) +
      componentToHex(rgbObject.b);
  }

  function componentToHex(c) {
    let hex = Math.round(c).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }

  function line(x1, y1, x2, y2) {
    if (lineThickness !== 0) {
      ctx.beginPath();
      ctx.lineJoin = "round";
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
}
