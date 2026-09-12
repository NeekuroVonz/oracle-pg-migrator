import { ProjectNav } from "@/components/project-nav";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ProjectNav />
      {children}
    </>
  );
}
