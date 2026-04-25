import { ArrowRight } from "lucide-react";
import helmorLogoSrc from "@/assets/helmor-logo.png";
import helmorScreenshotSrc from "@/assets/helmor-screenshot-dark.png";
import { Button } from "@/components/ui/button";
import type { OnboardingStep } from "../types";

export function IntroPreview({
	step,
	onNext,
}: {
	step: OnboardingStep;
	onNext: () => void;
}) {
	return (
		<div
			aria-hidden={step !== "intro"}
			className={`relative z-10 grid h-full grid-cols-[minmax(360px,0.84fr)_minmax(460px,1.16fr)] items-center gap-12 px-14 pt-10 pb-12 max-lg:grid-cols-1 max-lg:content-center max-lg:gap-8 max-lg:px-8 ${step !== "intro" ? "pointer-events-none" : ""}`}
		>
			<section
				className={`flex min-w-0 flex-col items-start transition-transform duration-1000 ease-[cubic-bezier(.22,.82,.2,1)] ${step !== "intro" ? "-translate-x-[58vw]" : "translate-x-0"}`}
			>
				<img
					src={helmorLogoSrc}
					alt="Helmor"
					draggable={false}
					className="size-12 rounded-[9px] opacity-95"
				/>
				<h1 className="mt-8 max-w-[13ch] text-5xl font-semibold leading-[0.98] tracking-normal text-foreground max-lg:text-4xl">
					Welcome to Helmor
				</h1>
				<p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
					A local-first workspace for running agents, reviewing work, and
					keeping project context close.
				</p>

				<Button
					type="button"
					size="lg"
					onClick={onNext}
					className="mt-8 h-11 gap-2 px-4 text-[0.95rem]"
				>
					Next
					<ArrowRight data-icon="inline-end" className="size-4" />
				</Button>
			</section>

			<section
				aria-label="Helmor preview"
				className={`relative flex min-h-[420px] min-w-0 items-center justify-center transition-transform duration-1000 ease-[cubic-bezier(.22,.82,.2,1)] max-lg:hidden ${
					step === "skills" || step === "repoImport"
						? "translate-x-[32vw] translate-y-[2vh]"
						: step === "completeTransition"
							? "translate-x-[52vw] -translate-y-[18vh] opacity-0"
							: step === "conductorTransition"
								? "translate-x-[44vw] -translate-y-[12vh] opacity-0"
								: step === "corner"
									? "-translate-x-[86vw] translate-y-[57vh]"
									: step === "agents"
										? "-translate-x-[22vw] -translate-y-[51vh]"
										: "translate-x-0 translate-y-0"
				}`}
			>
				<div
					aria-hidden
					className="absolute left-6 top-7 h-28 w-64 border-l border-t border-border/70"
				/>
				<div
					aria-hidden
					className="absolute bottom-9 right-2 h-32 w-72 border-r border-b border-border/70"
				/>
				<div
					className={`relative w-full max-w-[760px] overflow-hidden rounded-lg border border-border/70 bg-card shadow-2xl shadow-black/35 transition-transform duration-1000 ease-[cubic-bezier(.22,.82,.2,1)] ${
						step === "skills" || step === "repoImport"
							? "scale-[1.72]"
							: step === "completeTransition"
								? "scale-[1.95]"
								: step === "conductorTransition"
									? "scale-[1.95]"
									: step === "corner"
										? "scale-[2.24]"
										: step === "agents"
											? "scale-[1.5]"
											: "scale-100"
					}`}
				>
					<img
						src={helmorScreenshotSrc}
						alt="Helmor workspace preview"
						draggable={false}
						className="w-full object-cover"
					/>
				</div>
			</section>
		</div>
	);
}
