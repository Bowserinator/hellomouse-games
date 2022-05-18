// @ts-nocheck
import { dx, dy } from "./directions.js";

export default function solve(
  maze,
  startPoint = "top left",
  endPoint = "bottom right",
) {
  startPoint = maze.algorithm.getXYPosition(startPoint);
  endPoint = maze.algorithm.getXYPosition(endPoint);
  let { distances, maxDistance } = maze.getDistances(startPoint);

  startPoint = {
    x: constrain(startPoint.x, 0, maze.algorithm.width - 1),
    y: constrain(startPoint.y, 0, maze.algorithm.height - 1),
  };

  endPoint = {
    x: constrain(endPoint.x, 0, maze.algorithm.width - 1),
    y: constrain(endPoint.y, 0, maze.algorithm.height - 1),
  };

  let Q = []; //queue

  let discovered = []; //keeps track of which points have been discovered so far so it doesn't loop back on itself
  distances = [];
  for (let y = 0; y < maze.algorithm.height; y++) {
    discovered[y] = [];
    distances[y] = [];
    for (let x = 0; x < maze.algorithm.width; x++) {
      distances[y][x] = 0;
      discovered[y][x] = false;
    }
  }
  discovered[startPoint.y][startPoint.x] = true;

  //enqueue
  Q.unshift(startPoint);

  let depth = 0;

  while (Q.length > 0) {
    depth++;
    //dequeue
    let v = Q.pop();

    if (v.x === endPoint.x && v.y === endPoint.y) {
      //We have reached the finish point. Now we need to convert the route into an array of points that we can use to draw the line

      let solutionPath = [];
      let cell = v;
      solutionPath.unshift({
        x: cell.x,
        y: cell.y,
      });
      while (
        !(cell.parent === undefined ||
          (cell.parent.x === cell.x && cell.parent.y === cell.y))
      ) {
        cell = cell.parent;
        solutionPath.unshift({
          x: cell.x,
          y: cell.y,
        });
      }

      //add extra lines at the beginning and end that go outside of the maze,
      //provided we are removing these walls and that we know what direction it should be
      if (maze.algorithm.removeWallsAtEntranceAndExit) {
        if (startPoint.direction !== undefined) {
          solutionPath.unshift({
            x: startPoint.x + dx[startPoint.direction],
            y: startPoint.y + dy[startPoint.direction],
          });
        }

        if (endPoint.direction !== undefined) {
          solutionPath.push({
            x: endPoint.x + dx[endPoint.direction],
            y: endPoint.y + dy[endPoint.direction],
          });
        }
      }

      return solutionPath;
    }

    for (let direction in maze.algorithm.walls[v.y][v.x]) {
      //there's not a wall here so we can go this way
      if (!maze.algorithm.walls[v.y][v.x][direction]) {
        let x = v.x + dx[direction];
        let y = v.y + dy[direction];

        //valid cell to move to
        if (discovered[y] !== undefined && discovered[y][x] !== undefined) {
          //hasn't already been visited (discovered)
          if (!discovered[y][x]) {
            discovered[y][x] = true;
            distances[y][x] = depth;
            //enqueue
            Q.unshift({
              x: x,
              y: y,
              parent: v,
            });
          }
        }
      }
    }
  }

  //console.log("failed to find a solution");
  return [];
}

function constrain(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
