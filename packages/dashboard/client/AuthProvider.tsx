import { createContext, useContext, useEffect, useCallback, useState } from "react";
import { getAccessToken, clearTokens, setTokens } from "./lib/auth";
import { trpc } from "./trpc";

type User = { id: number; email: string; orgId: number; orgName: string; onboardingStep: number; onboardingCompletedAt: string | null };
type Org = { id: number; name: string; role: string };
type AuthCtx = {
  user: User | null;
  orgs: Org[];
  isLoading: boolean;
  login: () => void;
  logout: () => void;
  switchOrg: (orgId: number) => Promise<void>;
  createOrg: (name: string) => Promise<void>;
  deleteOrg: (orgId: number) => Promise<void>;
  deleteAccount: () => Promise<void>;
  refreshOrgs: () => Promise<void>;
  updateOnboardingStep: (step: number) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  updateOnboardingProfile: (data: { role?: string; teamSize?: string; useCase?: string }) => Promise<void>;
  resetOnboarding: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const utils = trpc.useUtils();
  const [hasToken, setHasToken] = useState(() => !!getAccessToken());

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: hasToken,
    retry: false,
  });

  const orgsQuery = trpc.auth.orgs.useQuery(undefined, {
    enabled: hasToken && meQuery.isSuccess,
    retry: false,
  });

  useEffect(() => {
    if (!meQuery.isError || !getAccessToken()) return;
    const status = (meQuery.error as any)?.data?.httpStatus;
    if (status === 401 || status === 403) {
      clearTokens();
      setHasToken(false);
    }
  }, [meQuery.isError, meQuery.error]);

  useEffect(() => {
    if (!meQuery.data || !orgsQuery.data) return;
    const inOrg = orgsQuery.data.some((o) => o.id === meQuery.data.orgId);
    if (inOrg) return;
    if (orgsQuery.data.length > 0) {
      switchOrgMutation.mutate({ orgId: orgsQuery.data[0].id });
    } else {
      clearTokens();
      setHasToken(false);
      utils.auth.me.reset();
      utils.auth.orgs.reset();
    }
  }, [meQuery.data, orgsQuery.data]);

  const switchOrgMutation = trpc.auth.switchOrg.useMutation({
    onSuccess: async (tokens) => {
      setTokens(tokens.accessToken, tokens.refreshToken);
      await utils.invalidate();
    },
  });

  const createOrgMutation = trpc.auth.createOrg.useMutation({
    onSuccess: async (org) => {
      await switchOrgMutation.mutateAsync({ orgId: org.id });
    },
  });

  const deleteOrgMutation = trpc.auth.deleteOrg.useMutation();
  const deleteAccountMutation = trpc.auth.deleteAccount.useMutation();
  const updateOnboardingStepMutation = trpc.auth.updateOnboardingStep.useMutation({ onSuccess: () => utils.auth.me.invalidate() });
  const completeOnboardingMutation = trpc.auth.completeOnboarding.useMutation({ onSuccess: () => utils.auth.me.invalidate() });
  const updateOnboardingProfileMutation = trpc.auth.updateOnboardingProfile.useMutation({ onSuccess: () => utils.auth.me.invalidate() });
  const resetOnboardingMutation = trpc.auth.resetOnboarding.useMutation({ onSuccess: () => utils.auth.me.invalidate() });

  const switchOrg = useCallback(async (orgId: number) => {
    await switchOrgMutation.mutateAsync({ orgId });
  }, [switchOrgMutation]);

  const createOrg = useCallback(async (name: string) => {
    await createOrgMutation.mutateAsync({ name });
  }, [createOrgMutation]);

  const deleteOrg = useCallback(async (orgId: number) => {
    await deleteOrgMutation.mutateAsync({ orgId });
    const remaining = (orgsQuery.data ?? []).filter((o) => o.id !== orgId);
    if (remaining.length > 0) {
      await switchOrgMutation.mutateAsync({ orgId: remaining[0].id });
    } else {
      clearTokens();
      setHasToken(false);
      utils.auth.me.reset();
      utils.auth.orgs.reset();
    }
  }, [deleteOrgMutation, orgsQuery.data, switchOrgMutation, utils]);

  const deleteAccount = useCallback(async () => {
    await deleteAccountMutation.mutateAsync();
    clearTokens();
    setHasToken(false);
    utils.auth.me.reset();
    utils.auth.orgs.reset();
  }, [deleteAccountMutation, utils]);

  const refreshOrgs = useCallback(async () => {
    await utils.auth.orgs.invalidate();
  }, [utils]);

  const updateOnboardingStep = useCallback(async (step: number) => {
    await updateOnboardingStepMutation.mutateAsync({ step });
  }, [updateOnboardingStepMutation]);

  const completeOnboarding = useCallback(async () => {
    await completeOnboardingMutation.mutateAsync();
  }, [completeOnboardingMutation]);

  const updateOnboardingProfile = useCallback(async (data: { role?: string; teamSize?: string; useCase?: string }) => {
    await updateOnboardingProfileMutation.mutateAsync(data);
  }, [updateOnboardingProfileMutation]);

  const resetOnboarding = useCallback(async () => {
    localStorage.removeItem("onboarding_sandbox_project_id");
    localStorage.removeItem("sandbox_banner_dismissed");
    localStorage.removeItem("skip_banner_dismissed");
    await resetOnboardingMutation.mutateAsync();
  }, [resetOnboardingMutation]);

  const logout = useCallback(() => {
    const refreshToken = localStorage.getItem("ysa_refresh_token");
    fetch("/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
    clearTokens();
    setHasToken(false);
    utils.auth.me.reset();
    utils.auth.orgs.reset();
  }, [utils]);

  const user = meQuery.data ?? null;
  const orgs = orgsQuery.data ?? [];
  const isLoading = hasToken && (meQuery.isPending || (meQuery.isSuccess && orgsQuery.isPending) || switchOrgMutation.isPending);

  return (
    <AuthContext.Provider value={{
      user,
      orgs,
      isLoading,
      login: () => setHasToken(true),
      logout,
      switchOrg,
      createOrg,
      deleteOrg,
      deleteAccount,
      refreshOrgs,
      updateOnboardingStep,
      completeOnboarding,
      updateOnboardingProfile,
      resetOnboarding,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
