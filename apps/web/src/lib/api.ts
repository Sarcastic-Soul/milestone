import type { PlanDraft, ProjectDetail, ProjectSummary, SuggestionDraft } from "@milestone/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: () => request<ProjectSummary[]>("/projects") });
}

export function useProject(id: string) {
  return useQuery({ queryKey: ["project", id], queryFn: () => request<ProjectDetail>(`/projects/${id}`) });
}

export type Draft = { plan: PlanDraft; contractText: string };

export function useDraftPlan() {
  return useMutation({
    mutationFn: (input: { text?: string; file?: File }) => {
      const form = new FormData();
      if (input.text) form.set("text", input.text);
      if (input.file) form.set("file", input.file);
      return request<Draft>("/projects/draft", { method: "POST", body: form });
    },
  });
}

export function useSaveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: Draft) =>
      request<{ id: string }>("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useSendInvoice(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (milestoneId: string) =>
      request<{ invoiceId: string; payerUrl: string | null }>(
        `/projects/${projectId}/milestones/${milestoneId}/invoice`,
        { method: "POST" },
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: ["project", projectId] }),
  });
}

// Asks the agent to look at the project now. Results arrive over the live feed.
export function useCheckProject(projectId: string) {
  return useMutation({
    mutationFn: () => request<{ queued: boolean }>(`/projects/${projectId}/agent/check`, { method: "POST" }),
  });
}

export function useResolveSuggestion(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; action: "approve" | "dismiss"; draft?: SuggestionDraft }) =>
      request<{ ok: boolean }>(`/projects/${projectId}/suggestions/${input.id}/${input.action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: input.draft }),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["project", projectId] }),
  });
}
