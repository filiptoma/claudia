import type { ReactNode } from 'react'
import ItemCard from './ItemCard'
import type { MenuAction } from './ActionsMenu'

export default function ProjectCard({
  icon,
  title,
  titleAccessory,
  meta,
  to,
  menu,
  className,
}: {
  icon: ReactNode
  title: string
  titleAccessory?: ReactNode
  meta?: ReactNode
  to: string
  menu?: MenuAction[]
  className?: string
}) {
  return (
    <ItemCard
      icon={icon}
      title={title}
      titleAccessory={titleAccessory}
      meta={meta}
      to={to}
      menu={menu ?? []}
      className={className}
    />
  )
}
