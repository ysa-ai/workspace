import { TaskRow, type TaskData } from "./IssueRow";

interface TaskListProps {
  issues: TaskData[];
  selectedId: number | null;
  focusedIndex: number;
  onSelect: (id: number) => void;
  issueUrlTemplate?: string;
}

export function TaskList({ issues, selectedId, focusedIndex, onSelect, issueUrlTemplate }: TaskListProps) {
  if (issues.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 text-center">
        <p className="text-[13px] text-text-faint">No tasks yet. Enter task numbers or a prompt above.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {issues.map((issue, i) => (
        <TaskRow
          key={issue.task_id}
          issue={issue}
          selected={issue.task_id === selectedId}
          focused={i === focusedIndex && issue.task_id !== selectedId}
          onSelect={onSelect}
          issueUrlTemplate={issueUrlTemplate}
        />
      ))}
    </div>
  );
}

// Backwards-compat alias
export const IssueList = TaskList;
