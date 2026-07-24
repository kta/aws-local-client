import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface StateMachineSummary {
  stateMachineArn: string;
  name: string;
  type: string;
  createdAt: string | null;
}

export interface StateMachineDetail {
  stateMachineArn: string;
  name: string;
  status: string;
  definition: string;
  roleArn: string;
  type: string;
  createdAt: string | null;
}

export interface ExecutionRef {
  executionArn: string;
}

export interface ExecutionSummary {
  executionArn: string;
  name: string;
  status: string;
  startedAt: string | null;
  stoppedAt: string | null;
}

export interface ExecutionDetail {
  executionArn: string;
  stateMachineArn: string;
  name: string;
  status: string;
  input: string | null;
  output: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
}

export interface HistoryEvent {
  id: number;
  eventType: string;
  timestamp: string | null;
}

export const stepfunctions = {
  listStateMachines: (profile: ConnectionProfile) =>
    invoke<StateMachineSummary[]>("sfn_list_state_machines", { profile }),
  createStateMachine: (profile: ConnectionProfile, name: string, definition: string) =>
    invoke<void>("sfn_create_state_machine", { profile, name, definition }),
  updateStateMachine: (profile: ConnectionProfile, arn: string, definition: string) =>
    invoke<void>("sfn_update_state_machine", { profile, arn, definition }),
  deleteStateMachine: (profile: ConnectionProfile, arn: string) =>
    invoke<void>("sfn_delete_state_machine", { profile, arn }),
  describeStateMachine: (profile: ConnectionProfile, arn: string) =>
    invoke<StateMachineDetail>("sfn_describe_state_machine", { profile, arn }),
  startExecution: (profile: ConnectionProfile, arn: string, input: string) =>
    invoke<ExecutionRef>("sfn_start_execution", { profile, arn, input }),
  listExecutions: (profile: ConnectionProfile, arn: string) =>
    invoke<ExecutionSummary[]>("sfn_list_executions", { profile, arn }),
  describeExecution: (profile: ConnectionProfile, executionArn: string) =>
    invoke<ExecutionDetail>("sfn_describe_execution", { profile, executionArn }),
  getExecutionHistory: (profile: ConnectionProfile, executionArn: string) =>
    invoke<HistoryEvent[]>("sfn_get_execution_history", { profile, executionArn }),
};
