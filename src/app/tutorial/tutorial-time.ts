import type { DoorState } from "@/game/buildings";
import type { TaskView } from "@/game/types";
import type { TutorialFuture } from "./tutorial-types";

/** Tasks after a timepiece visit ends: past sabotage and repairs carry forward into the present. */
export function mergeReturnedTasks(future: TutorialFuture, current: { tasks: TaskView[] }): TaskView[] {
  return future.tasks.map((task) => {
      const past = current.tasks.find((item) => item.id === task.id);
      const before = future.baselineTasks.find((item) => item.id === task.id);
      if (!past || !before) return task;
      if (past.sabotaged && !before.sabotaged) return { ...task, done: false, delivered: false, sabotaged: true, progress: 0 };
      if (past.done && !before.done) return { ...task, done: true, delivered: true, progress: 1 };
      if (past.delivered && !before.delivered && !task.done) return { ...task, delivered: true };
      return task;
  });
}

/** Doors after a visit ends: past open/lock state and key holders carry forward. */
export function mergeReturnedDoors(future: TutorialFuture, current: { doors: DoorState[] }): DoorState[] {
  return future.doors.map((door) => {
      const past = current.doors.find((item) => item.id === door.id);
      const before = future.baselineDoors.find((item) => item.id === door.id);
      if (!past || !before) return door;
      const next = { ...door };
      if (past.open !== before.open || past.locked !== before.locked) { next.open = past.open; next.locked = past.locked; }
      if (past.holder === "me" && before.holder !== "me") { next.holder = "me"; next.keyX = null; }
      return next;
  });
}
