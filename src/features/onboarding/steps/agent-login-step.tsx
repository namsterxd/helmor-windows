import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentStatusAction } from "../components/agent-status-action";
import type { AgentLoginItem, OnboardingStep } from "../types";

export function AgentLoginStep({
	step,
	loginItems,
	onNext,
}: {
	step: OnboardingStep;
	loginItems: AgentLoginItem[];
	onNext: () => void;
}) {
	return (
		<section
			aria-label="Agent login"
			aria-hidden={step !== "agents"}
			className={`absolute inset-x-0 bottom-8 z-20 flex h-[54vh] flex-col items-center px-8 pb-12 pt-8 transition-all duration-1000 ease-[cubic-bezier(.22,.82,.2,1)] ${
				step === "corner"
					? "pointer-events-none -translate-x-[50vw] translate-y-[126vh] opacity-100"
					: step === "agents"
						? "translate-y-0 opacity-100"
						: "translate-y-10 opacity-0 pointer-events-none"
			}`}
		>
			<div className="w-full max-w-[720px]">
				<h2 className="text-3xl font-semibold tracking-normal text-foreground">
					Log in to your agents
				</h2>
				<p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
					Helmor uses your local Claude Code and Codex login sessions. You can
					log in now, or continue and log in later.
				</p>

				<div className="mt-7 flex w-full flex-col gap-3">
					{loginItems.map(
						({ icon: Icon, provider, label, description, status }) => (
							<div
								key={label}
								className="flex min-h-20 items-center gap-3 rounded-lg border border-border/55 bg-card/70 px-4 py-3"
							>
								<div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background text-foreground">
									<Icon className="size-5" />
								</div>
								<div className="min-w-0 flex-1">
									<div className="text-sm font-medium text-foreground">
										{label}
									</div>
									<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
										{description}
									</p>
								</div>
								<AgentStatusAction provider={provider} status={status} />
							</div>
						),
					)}
				</div>

				<Button
					type="button"
					size="lg"
					onClick={onNext}
					className="mt-7 h-11 gap-2 px-4 text-[0.95rem]"
				>
					Next
					<ArrowRight data-icon="inline-end" className="size-4" />
				</Button>
			</div>
		</section>
	);
}
