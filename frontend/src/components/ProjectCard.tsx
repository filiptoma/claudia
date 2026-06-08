import type { ReactNode } from "react";
import ItemCard from "./ItemCard";
import ProjectTypeBadge from "./ProjectTypeBadge";
import type { MenuAction } from "./ActionsMenu";
import type { ProjectType } from "../lib/types";

export default function ProjectCard({
  icon,
  title,
  projectType,
  accent,
  meta,
  to,
  menu,
  className,
}: {
  icon: ReactNode;
  title: string;
  /** Project source format — shown as a small `.md` / `.tex` pill after the title. */
  projectType?: ProjectType | null;
  accent?: 'default' | 'indigo' | 'blue';
  meta?: ReactNode;
  to: string;
  menu?: MenuAction[];
  className?: string;
}) {
  const accessory = projectType ? (
    <span className="flex items-center gap-1">
      <ProjectTypeBadge type={projectType} />
    </span>
  ) : undefined;
  return (
    <ItemCard
      icon={icon}
      title={title}
      titleAccessory={accessory}
      accent={accent}
      meta={meta}
      to={to}
      menu={menu ?? []}
      className={className}
    />
  );
}
