import { useRouteContext } from '../hooks/useRouteContext'
import ProjectHome from './ProjectHome'
import DocPage from './DocPage'

// Dispatches the project routes (/:project, /:project/:seg1, /:project/:seg1/:seg2) to the right
// screen: a document if the URL resolves to one, otherwise the project/folder listing (which also
// renders the not-found state for unresolved segments).
export default function ProjectScreen() {
  const { doc } = useRouteContext()
  return doc ? <DocPage /> : <ProjectHome />
}
