import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "./types";

export interface ClusterSummary {
  name: string;
  arn: string;
  status: string;
  activeServicesCount: number;
  runningTasksCount: number;
  pendingTasksCount: number;
  registeredContainerInstancesCount: number;
}

export interface TaskDefinitionSummary {
  arn: string;
  family: string;
  revision: number;
}

export interface ContainerDef {
  name: string;
  image: string;
  memory: number | null;
  cpu: number | null;
  essential: boolean;
  command: string[];
}

export interface TaskDefinitionDetail {
  arn: string;
  family: string;
  revision: number;
  status: string;
  registeredAt: string | null;
  containers: ContainerDef[];
}

export interface RegisterTaskDefResult {
  arn: string;
  family: string;
  revision: number;
  ignoredKeys: string[];
}

export interface ServiceSummary {
  name: string;
  arn: string;
  status: string;
  taskDefinition: string;
  desiredCount: number;
  runningCount: number;
  pendingCount: number;
}

export interface TaskSummary {
  arn: string;
  id: string;
  taskDefinitionArn: string;
  lastStatus: string;
  desiredStatus: string;
}

export const ecs = {
  listClusters: (profile: ConnectionProfile) =>
    invoke<ClusterSummary[]>("ecs_list_clusters", { profile }),
  createCluster: (profile: ConnectionProfile, name: string) =>
    invoke<void>("ecs_create_cluster", { profile, name }),
  deleteCluster: (profile: ConnectionProfile, name: string) =>
    invoke<void>("ecs_delete_cluster", { profile, name }),
  listTaskDefinitions: (profile: ConnectionProfile) =>
    invoke<TaskDefinitionSummary[]>("ecs_list_task_definitions", { profile }),
  registerTaskDefinition: (
    profile: ConnectionProfile,
    family: string,
    containerDefsJson: string,
  ) =>
    invoke<RegisterTaskDefResult>("ecs_register_task_definition", {
      profile,
      family,
      containerDefsJson,
    }),
  describeTaskDefinition: (profile: ConnectionProfile, arn: string) =>
    invoke<TaskDefinitionDetail>("ecs_describe_task_definition", { profile, arn }),
  deregisterTaskDefinition: (profile: ConnectionProfile, arn: string) =>
    invoke<void>("ecs_deregister_task_definition", { profile, arn }),
  listServices: (profile: ConnectionProfile, cluster: string) =>
    invoke<ServiceSummary[]>("ecs_list_services", { profile, cluster }),
  createService: (
    profile: ConnectionProfile,
    cluster: string,
    name: string,
    taskDef: string,
    desired: number,
  ) => invoke<void>("ecs_create_service", { profile, cluster, name, taskDef, desired }),
  updateService: (profile: ConnectionProfile, cluster: string, name: string, desired: number) =>
    invoke<void>("ecs_update_service", { profile, cluster, name, desired }),
  deleteService: (profile: ConnectionProfile, cluster: string, name: string) =>
    invoke<void>("ecs_delete_service", { profile, cluster, name }),
  listTasks: (profile: ConnectionProfile, cluster: string) =>
    invoke<TaskSummary[]>("ecs_list_tasks", { profile, cluster }),
  runTask: (profile: ConnectionProfile, cluster: string, taskDef: string) =>
    invoke<void>("ecs_run_task", { profile, cluster, taskDef }),
  stopTask: (profile: ConnectionProfile, cluster: string, taskArn: string) =>
    invoke<void>("ecs_stop_task", { profile, cluster, taskArn }),
};
