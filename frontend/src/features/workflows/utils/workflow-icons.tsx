import type { ComponentType } from 'react'
import {
  Check as LCheck,
  ChevronLeft as LChevronLeft,
  ChevronRight as LChevronRight,
  ChevronsDown as LChevronsDown,
  ChevronsUp as LChevronsUp,
  Circle as LCircle,
  Copy as LCopy,
  Download as LDownload,
  Eye as LEye,
  File as LFile,
  Folder as LFolder,
  FolderOpen as LFolderOpen,
  History as LHistory,
  Image as LImage,
  Info as LInfo,
  List as LList,
  Move as LMove,
  Plus as LPlus,
  RefreshCw as LRefresh,
  Save as LSave,
  Search as LSearch,
  Settings as LSettings,
  SlidersHorizontal as LSliders,
  Sparkles as LSparkles,
  Star as LStar,
  Tag as LTag,
  Text as LText,
  Upload as LUpload,
  Workflow as LWorkflow,
  X as LX,
} from 'lucide-react'

function adapt(Icon: ComponentType<any>) {
  return function WorkflowIcon(props: any) {
    const { sx, style, ...rest } = props || {}
    return <Icon {...rest} style={{ ...(style || {}), ...(sx || {}) }} />
  }
}

export const Add = adapt(LPlus)
export const AutoAwesome = adapt(LSparkles)
export const Block = adapt(LX)
export const CallMerge = adapt(LWorkflow)
export const CallSplit = adapt(LWorkflow)
export const Category = adapt(LList)
export const Check = adapt(LCheck)
export const CheckCircle = adapt(LCheck)
export const ChevronRight = adapt(LChevronRight)
export const CloudUpload = adapt(LUpload)
export const Close = adapt(LX)
export const ContentCopy = adapt(LCopy)
export const Delete = adapt(LX)
export const DoNotDisturb = adapt(LCircle)
export const Download = adapt(LDownload)
export const DragIndicator = adapt(LList)
export const DriveFileMove = adapt(LMove)
const ErrorCompat = adapt(LInfo)
export { ErrorCompat as Error }
export const ExpandLess = adapt(LChevronsUp)
export const ExpandMore = adapt(LChevronsDown)
export const FolderOpen = adapt(LFolderOpen)
export const Folder = adapt(LFolder)
export const History = adapt(LHistory)
export const Image = adapt(LImage)
export const InfoOutlined = adapt(LInfo)
export const Info = adapt(LInfo)
export const Input = adapt(LChevronRight)
export const InsertDriveFile = adapt(LFile)
export const Output = adapt(LChevronLeft)
export const PhotoLibrary = adapt(LImage)
export const PlaylistAdd = adapt(LPlus)
export const Refresh = adapt(LRefresh)
export const Save = adapt(LSave)
export const Search = adapt(LSearch)
export const Settings = adapt(LSettings)
export const Star = adapt(LStar)
export const Tag = adapt(LTag)
export const TextFields = adapt(LText)
export const TextSnippet = adapt(LText)
export const Tune = adapt(LSliders)
export const UnfoldLess = adapt(LChevronsUp)
export const UnfoldMore = adapt(LChevronsDown)
export const Videocam = adapt(LImage)
export const ViewList = adapt(LList)
export const ViewModule = adapt(LWorkflow)
export const Visibility = adapt(LEye)
export const AccountTree = adapt(LWorkflow)
