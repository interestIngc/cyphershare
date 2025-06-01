import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { WalletConnectButton } from "@/components/wallet-connect-button";
import { useWallet } from "@/context/wallet-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Geist, Geist_Mono } from "next/font/google";
import {
  Upload,
  Download,
  FileIcon,
  Copy,
  Edit,
  Check,
  File,
  FileText,
  Image,
  Github,
  Settings,
  Server,
  Radio,
  Terminal,
  AlertCircle,
  Info,
  Waypoints,
  Lock,
  Unlock,
  Shield,
  Eye,
  Mail,
  KeyRound, // For secret
  Send, // For submit proof
} from "lucide-react";
import Head from "next/head";
import { useDropzone } from "react-dropzone";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { useCodex, getCodexClient } from "@/hooks/useCodex";
import useWaku, { WakuFileMessage } from "@/hooks/useWaku";
import axios from "axios";
import { cn } from "@/lib/utils";
import { domains } from "@nucypher/taco";
import useTaco from "@/hooks/useTaco";
import { ethers } from "ethers";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

declare global {
  interface Window {
    ethereum?: any;
    loadPyodide: (options?: { indexURL: string }) => Promise<any>; // Pyodide instance
  }
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

interface FileItem {
  id: number | string;
  name: string;
  size: number;
  type: string;
  timestamp: string;
  fileId?: string;
  isEncrypted?: boolean;
  accessCondition?: string;
  isUploading?: boolean;
  progress?: number;
  scriptHash?: string; // Added for Python files that have been run
}

interface ExtendedNodeInfo {
  id: string;
  version: string;
  revision?: string;
  status: string;
  uptime: string;
  peers?: number;
}

// Helper to calculate SHA256 hash
async function calculateSha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hashHex}`;
}

export default function Home() {
  const [roomId, setRoomId] = useState("XYZ123");
  const [isEditingRoom, setIsEditingRoom] = useState(false);
  const [copiedRoom, setCopiedRoom] = useState(false);
  const [codexNodeUrl, setCodexNodeUrl] = useState(
    process.env.NEXT_PUBLIC_CODEX_REMOTE_API_URL || ""
  );
  const [codexEndpointType, setCodexEndpointType] = useState<
    "remote" | "local"
  >("remote");
  const [wakuNodeUrl, setWakuNodeUrl] = useState("http://127.0.0.1:8645");
  const [wakuNodeType, setWakuNodeType] = useState("light");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [nodeInfo, setNodeInfo] = useState<ExtendedNodeInfo | null>(null);

  const { provider, signer, walletConnected, connectWallet, walletAddress } =
    useWallet(); // Added walletAddress
  const timeInputRef = useRef<HTMLDivElement>(null);
  const useEncryptionInputRef = useRef<HTMLDivElement>(null);
  const [useEncryption, setUseEncryption] = useState(false);

  const [accessConditionType, setAccessConditionType] = useState<
    "time" | "positive" | "amoyNFTUserSpecified"
  >("positive");
  const [nftContractAddress, setNftContractAddress] = useState("");
  const nftContractAddressInputRef = useRef<HTMLDivElement>(null);

  const [isViewPyModalOpen, setIsViewPyModalOpen] = useState(false);
  const [pyFileContent, setPyFileContent] = useState("");
  const [selectedPyFileForView, setSelectedPyFileForView] =
    useState<FileItem | null>(null);
  const pyFileInputRef = useRef<HTMLInputElement>(null);

  // NEW: Email proof related state
  const [computationSecret, setComputationSecret] = useState<string | null>(
    null
  );
  const [isProofSubmissionModalOpen, setIsProofSubmissionModalOpen] =
    useState(false);
  const [emailProofSubject, setEmailProofSubject] = useState("");
  const [emailProofBodyInstruction, setEmailProofBodyInstruction] =
    useState("");
  const [selectedEmlFileForProof, setSelectedEmlFileForProof] =
    useState<File | null>(null);
  const proofEmlFileInputRef = useRef<HTMLInputElement>(null);
  const [isSubmittingEmailProof, setIsSubmittingEmailProof] = useState(false);

  const [pyodide, setPyodide] = useState<any>(null);
  const [isPyodideReady, setIsPyodideReady] = useState(false);
  const [pyodideLoadingMessage, setPyodideLoadingMessage] = useState<
    string | null
  >("Pyodide loading not yet started.");
  const [pyodideOutput, setPyodideOutput] = useState<string[]>([]);
  const [selectedDataFiles, setSelectedDataFiles] = useState<FileList | null>(
    null
  );
  const [isScriptRunning, setIsScriptRunning] = useState(false);
  const [pyodideOutputFilePath, setPyodideOutputFilePath] = useState<
    string | null
  >(null);
  const [isUploadingPyodideOutput, setIsUploadingPyodideOutput] =
    useState(false);
  const [pyodideOutputUploadProgress, setPyodideOutputUploadProgress] =
    useState(0);

  useEffect(() => {
    const loadPyodideInstance = async () => {
      setPyodideLoadingMessage("Loading Pyodide runtime...");
      console.log("Attempting to load Pyodide...");
      try {
        const pyodideModule = await window.loadPyodide({
          indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/", // Consider v0.26 or latest
        });
        setPyodide(pyodideModule);
        setIsPyodideReady(true);
        setPyodideLoadingMessage("Pyodide loaded successfully.");
        console.log("Pyodide loaded successfully");
      } catch (error) {
        console.error("Failed to load Pyodide:", error);
        setPyodideLoadingMessage(
          `Error loading Pyodide: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        setIsPyodideReady(false);
      }
    };

    if (typeof window !== "undefined" && !pyodide && !isPyodideReady) {
      if (!window.loadPyodide) {
        setPyodideLoadingMessage("Loading Pyodide script from CDN...");
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js";
        script.onload = () => {
          console.log("Pyodide script loaded from CDN.");
          loadPyodideInstance();
        };
        script.onerror = () => {
          console.error("Failed to load Pyodide script from CDN.");
          setPyodideLoadingMessage(
            "Failed to load Pyodide script. Check network or adblockers."
          );
        };
        document.head.appendChild(script);
        return () => {
          if (document.head.contains(script)) {
            document.head.removeChild(script);
          }
        };
      } else {
        loadPyodideInstance();
      }
    } else if (
      pyodide &&
      isPyodideReady &&
      pyodideLoadingMessage !== "Pyodide is ready." &&
      pyodideLoadingMessage !== "Pyodide loaded successfully." // Add this condition
    ) {
      setPyodideLoadingMessage("Pyodide is ready.");
    }
  }, [pyodide, isPyodideReady, pyodideLoadingMessage]); // Added pyodideLoadingMessage dependency

  useEffect(() => {
    if (accessConditionType === "time" && timeInputRef.current) {
      setTimeout(() => {
        timeInputRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 100);
    }
    if (
      accessConditionType === "amoyNFTUserSpecified" &&
      nftContractAddressInputRef.current
    ) {
      setTimeout(() => {
        nftContractAddressInputRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 100);
    }
  }, [accessConditionType]);

  useEffect(() => {
    if (useEncryption && useEncryptionInputRef.current) {
      setTimeout(() => {
        useEncryptionInputRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 100);
    }
  }, [useEncryption]);

  const [windowTimeSeconds, setWindowTimeSeconds] = useState("60");
  const [decryptionInProgress, setDecryptionInProgress] = useState<
    Record<string, boolean>
  >({});
  const [decryptionError, setDecryptionError] = useState<string | null>(null);

  const ritualId = 6; // Example Ritual ID

  const {
    isInit: isTacoInit,
    encryptDataToBytes,
    decryptDataFromBytes,
    createConditions,
  } = useTaco({
    provider: provider as ethers.providers.Provider | undefined,
    domain: domains.TESTNET, // or domains.MAINNET
    ritualId,
  });

  const [sentFiles, setSentFiles] = useState<FileItem[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<FileItem[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<{
    [key: string]: {
      progress: number;
      name: string;
      size: number; // Keep size in bytes for consistency
      type: string;
      timestamp?: string;
      isEncrypted?: boolean;
      accessCondition?: string;
    };
  }>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  const {
    isNodeActive: isCodexNodeActive,
    isLoading: isCodexLoading,
    updateConfig: updateCodexConfig,
    checkNodeStatus: checkCodexStatus,
    error: codexError,
    getNodeInfo,
    getCodexClient, // Make sure this is correctly imported/used if needed directly
    testDirectUpload: codexTestUpload,
    downloadFile,
  } = useCodex(codexNodeUrl); // Pass initial URL if needed

  const [wakuDebugVisible, setWakuDebugVisible] = useState(false);
  const [wakuDebugLogs, setWakuDebugLogs] = useState<
    {
      type: "info" | "error" | "success";
      message: string;
      timestamp: string;
    }[]
  >([]);

  const addWakuDebugLog = useCallback(
    (type: "info" | "error" | "success", message: string) => {
      setWakuDebugLogs((prev) => [
        { type, message, timestamp: new Date().toLocaleTimeString() },
        ...prev.slice(0, 19), // Keep last 20 logs
      ]);
    },
    []
  );

  const handleFileReceived = useCallback(
    (fileMessage: WakuFileMessage) => {
      const ourSenderId = sessionStorage.getItem("wakuSenderId");
      addWakuDebugLog(
        "info",
        `Message received: ${
          fileMessage.fileName
        } from ${fileMessage.sender.substring(0, 8)}`
      );

      const isSentByUs = ourSenderId && fileMessage.sender === ourSenderId;
      if (isSentByUs) {
        console.log(
          "Ignoring file we sent:",
          fileMessage.fileName,
          "from sender:",
          fileMessage.sender
        );
        addWakuDebugLog(
          "info",
          `Ignoring our own message: ${fileMessage.fileName}`
        );
        return;
      }

      const isInSentFiles = sentFiles.some(
        (file) => file.fileId === fileMessage.fileId
      );
      if (isInSentFiles) {
        console.log(
          "Ignoring file already in our sent files:",
          fileMessage.fileName
        );
        addWakuDebugLog(
          "info",
          `Ignoring file already in our sent files: ${fileMessage.fileName}`
        );
        return;
      }

      console.log("Received new file from peer:", {
        fileName: fileMessage.fileName,
        sender: fileMessage.sender, // Log the full sender ID for debugging
        fileId: fileMessage.fileId,
        timestamp: fileMessage.timestamp, // This is already a number (Date.now())
        encrypted: fileMessage.isEncrypted,
        accessCondition: fileMessage.accessCondition,
      });
      addWakuDebugLog("success", `New file from peer: ${fileMessage.fileName}`);

      const fileExists = receivedFiles.some(
        (file) => file.fileId === fileMessage.fileId
      );
      if (fileExists) {
        addWakuDebugLog("info", `File already exists: ${fileMessage.fileName}`);
        return; // Already have this file
      }

      const timestamp = new Date(fileMessage.timestamp).toLocaleString(
        "en-US",
        {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }
      );

      const newFile: FileItem = {
        id: `received-${fileMessage.timestamp}-${fileMessage.fileName}`, // Unique ID
        name: fileMessage.fileName,
        size: fileMessage.fileSize, // Assuming fileSize is in MB from Waku message
        type: fileMessage.fileType,
        timestamp,
        fileId: fileMessage.fileId,
        isEncrypted: fileMessage.isEncrypted,
        accessCondition: fileMessage.accessCondition,
      };

      setReceivedFiles((prev) => [newFile, ...prev]);
      setCopySuccess(`Received file: ${fileMessage.fileName}`);
      setTimeout(() => setCopySuccess(null), 3000);
      addWakuDebugLog(
        "success",
        `Added to received files: ${fileMessage.fileName}`
      );
    },
    [receivedFiles, sentFiles, addWakuDebugLog] // Add sentFiles to dependencies
  );

  const {
    isConnecting: isWakuConnecting,
    isConnected: isWakuConnected,
    error: wakuError,
    sendFileMessage,
    peerCount: wakuPeerCount,
    contentTopic: wakuContentTopic,
    reconnect: reconnectWaku,
  } = useWaku({
    roomId,
    wakuNodeUrl, // This would be for a relay node if that mode was fully supported
    wakuNodeType: wakuNodeType as "light" | "relay", // Cast for now
    onFileReceived: handleFileReceived,
  });

  const isValidNodeInfo = (info: unknown): info is ExtendedNodeInfo => {
    if (!info || typeof info !== "object") return false;
    const nodeInfo = info as Partial<ExtendedNodeInfo>;
    return (
      typeof nodeInfo.version === "string" &&
      typeof nodeInfo.status === "string" &&
      typeof nodeInfo.uptime === "string" &&
      (typeof nodeInfo.id === "string" || nodeInfo.id === undefined) && // Allow id to be optional initially
      (typeof nodeInfo.revision === "string" ||
        nodeInfo.revision === undefined) &&
      (typeof nodeInfo.peers === "number" || nodeInfo.peers === undefined)
    );
  };

  useEffect(() => {
    if (isCodexNodeActive && !isCodexLoading) {
      const fetchNodeInfo = async () => {
        const info = await getNodeInfo();
        if (info && isValidNodeInfo(info)) setNodeInfo(info);
        else setNodeInfo(null); // Set to null if info is not valid
      };
      fetchNodeInfo();
    } else {
      setNodeInfo(null); // Clear node info if not active or loading
    }
  }, [isCodexNodeActive, isCodexLoading, getNodeInfo]);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!isCodexNodeActive) {
        setUploadError(
          "Codex node is not active. Please check your connection."
        );
        setTimeout(() => setUploadError(null), 5000);
        return;
      }

      if (useEncryption && !walletConnected) {
        // Try to connect wallet if not already connected for encryption
        const connected = await connectWallet(); // connectWallet from useWallet
        if (!connected) {
          setUploadError(
            "Please connect your wallet to use encryption features."
          );
          setTimeout(() => setUploadError(null), 5000);
          return;
        }
      }

      acceptedFiles.forEach((file) => {
        console.log(
          "----------------------------- Processing file for upload:",
          file.name
        );
        const fileId = `upload-${Date.now()}-${file.name}`; // Unique key for tracking this upload

        setUploadingFiles((prev) => ({
          ...prev,
          [fileId]: {
            progress: 0,
            name: file.name,
            size: file.size, // Store size in bytes
            type: file.type,
            // timestamp, isEncrypted, accessCondition will be set after successful upload logic
          },
        }));

        const uploadFile = async () => {
          try {
            let fileToUpload = file;
            let isFileEncrypted = false;
            let accessConditionDescription = "";

            if (useEncryption && walletConnected && signer) {
              // Ensure signer is available
              try {
                let accessCondition;
                // ... (rest of your TACo condition logic) ...
                if (accessConditionType === "positive") {
                  accessCondition = createConditions.positiveBalance();
                  accessConditionDescription = `The account needs to have a positive balance, to be able to decrypt this file`;
                } else if (accessConditionType === "time") {
                  accessCondition =
                    await createConditions.withinNumberOfSeconds(
                      Number(windowTimeSeconds)
                    );
                  accessConditionDescription = `Accessible only within ${windowTimeSeconds} seconds of  ${new Date().toLocaleTimeString()} (${new Date().toLocaleDateString()})`;
                } else if (accessConditionType === "amoyNFTUserSpecified") {
                  if (
                    !nftContractAddress ||
                    !ethers.utils.isAddress(nftContractAddress)
                  ) {
                    setUploadError(
                      "Please enter a valid Amoy ERC721 contract address for the NFT condition."
                    );
                    setTimeout(() => setUploadError(null), 5000);
                    setUploadingFiles((prev) => {
                      // Remove from uploading on error
                      const updated = { ...prev };
                      delete updated[fileId];
                      return updated;
                    });
                    return;
                  }
                  accessCondition =
                    createConditions.isAmoyNFTOwner(nftContractAddress);
                  accessConditionDescription = `Requires ownership of an NFT from contract ${nftContractAddress.substring(
                    0,
                    6
                  )}...${nftContractAddress.substring(
                    nftContractAddress.length - 4
                  )} on Polygon Amoy.`;
                } else {
                  throw new Error("Invalid access condition type");
                }

                const arrayBuffer = await file.arrayBuffer();
                const fileBytes = new Uint8Array(arrayBuffer);

                console.log("Preparing to encrypt file...", {
                  fileName: file.name,
                  fileSize: fileBytes.length,
                  accessCondition: accessConditionDescription,
                });

                const encryptedBytes = await encryptDataToBytes(
                  fileBytes,
                  accessCondition,
                  signer
                );

                if (encryptedBytes) {
                  fileToUpload = new globalThis.File(
                    [encryptedBytes],
                    `${file.name}.enc`,
                    {
                      type: "application/octet-stream", // Standard for encrypted files
                      lastModified: file.lastModified,
                    }
                  );
                  isFileEncrypted = true;
                  console.log("File encrypted successfully");
                } else {
                  throw new Error(
                    "Encryption process did not return encrypted bytes."
                  );
                }
              } catch (conditionOrEncryptError) {
                console.error(
                  "Error during encryption setup or process:",
                  conditionOrEncryptError
                );
                setUploadError(
                  `Encryption failed: ${
                    conditionOrEncryptError instanceof Error
                      ? conditionOrEncryptError.message
                      : "Unknown error"
                  }`
                );
                setTimeout(() => setUploadError(null), 5000);
                // Also remove from uploadingFiles if encryption fails before upload starts
                setUploadingFiles((prev) => {
                  const updated = { ...prev };
                  delete updated[fileId];
                  return updated;
                });
                return; // Stop the upload for this file
              }
            }

            // Use the getCodexClient from the hook
            const client = getCodexClient(); // Assuming useCodex hook provides this
            const result = await client.uploadFile(
              fileToUpload,
              (progress: number) => {
                setUploadingFiles((prev) => ({
                  ...prev,
                  [fileId]: { ...prev[fileId], progress },
                }));
              }
            );

            if (result.success && result.id) {
              const timestamp = new Date().toLocaleString("en-US", {
                /* format options */
              });
              console.log("========== UPLOAD RESULT ==========");
              console.log(JSON.stringify(result, null, 2));
              console.log("===================================");
              console.log("✅ File uploaded successfully. CID:", result.id);
              console.log(
                "%c Copy this CID: " + result.id,
                "background: #222; color: #bada55; padding: 2px 5px; border-radius: 2px;"
              );

              const newFile: FileItem = {
                id: fileId, // Use the tracking ID
                name: file.name, // Original file name
                isEncrypted: isFileEncrypted,
                accessCondition: isFileEncrypted
                  ? accessConditionDescription
                  : undefined,
                size: parseFloat((file.size / (1024 * 1024)).toFixed(2)), // Size in MB
                type: file.type, // Original file type
                timestamp,
                fileId: result.id, // CID from Codex
              };
              console.log("Adding file to sent files:", newFile);
              setSentFiles((prev) => [newFile, ...prev]);

              if (isWakuConnected) {
                await sendFileMessage({
                  fileName: file.name,
                  fileSize: parseFloat((file.size / (1024 * 1024)).toFixed(2)), // Size in MB
                  fileType: file.type,
                  fileId: result.id, // CID
                  isEncrypted: isFileEncrypted,
                  accessCondition: isFileEncrypted
                    ? accessConditionDescription
                    : undefined,
                });
                console.log("File shared with peers via Waku");
              }
            } else {
              setUploadError(
                `Failed to upload ${file.name}: ${
                  result.error || "Unknown upload error"
                }`
              );
              setTimeout(() => setUploadError(null), 5000);
            }
          } catch (error) {
            setUploadError(
              `Error uploading ${file.name}: ${
                error instanceof Error ? error.message : "Unknown error"
              }`
            );
            setTimeout(() => setUploadError(null), 5000);
          } finally {
            setUploadingFiles((prev) => {
              const updated = { ...prev };
              delete updated[fileId];
              return updated;
            });
          }
        };
        uploadFile();
      });
    },
    [
      isCodexNodeActive,
      getCodexClient,
      isWakuConnected,
      sendFileMessage,
      useEncryption,
      walletConnected,
      signer,
      accessConditionType,
      createConditions,
      windowTimeSeconds,
      encryptDataToBytes,
      connectWallet, // from useWallet
      nftContractAddress,
    ]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxSize: 100 * 1024 * 1024, // 100MB limit
  });

  const getFileIcon = (fileType: string) => {
    if (fileType.includes("image")) return <Image size={24} />;
    if (fileType.includes("pdf")) return <FileText size={24} />;
    if (fileType.includes("python") || fileType.endsWith(".py"))
      return <Terminal size={24} />; // Icon for Python files
    if (
      fileType.includes("spreadsheet") ||
      fileType.includes("excel") ||
      fileType.includes("xlsx") ||
      fileType.includes("csv")
    )
      return <FileText size={24} />;
    if (
      fileType.includes("presentation") ||
      fileType.includes("powerpoint") ||
      fileType.includes("pptx")
    )
      return <FileText size={24} />;
    if (fileType.includes("zip") || fileType.includes("archive"))
      return <File size={24} />;
    return <FileIcon size={24} />;
  };

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopiedRoom(true);
    setTimeout(() => setCopiedRoom(false), 2000);
  };

  const [copiedFileCid, setCopiedFileCid] = useState<string | null>(null);

  const copyToClipboard = (text: string): boolean => {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      // Make the textarea off-screen
      textarea.style.position = "fixed";
      textarea.style.left = "-999999px";
      textarea.style.top = "-999999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      return success;
    } catch (error) {
      console.error("Failed to copy text:", error);
      return false;
    }
  };

  // Test function for clipboard copy - can be removed in production
  const testClipboardCopy = (text: string) => {
    const success = copyToClipboard(text);
    if (success) {
      console.log("Successfully copied to clipboard:", text);
      setCopySuccess(`Test text copied to clipboard: ${text}`);
    } else {
      console.error("Failed to copy to clipboard");
      setUploadError("Failed to copy to clipboard"); // Or a more specific error state
    }
    setTimeout(() => {
      setCopySuccess(null);
      setUploadError(null);
    }, 2000);
  };

  const testDirectUpload = async () => {
    if (!isCodexNodeActive) {
      setUploadError("Codex node is not active. Please check your connection.");
      setTimeout(() => setUploadError(null), 5000);
      return;
    }
    try {
      const result = await codexTestUpload(); // Assuming codexTestUpload is from useCodex
      if (result.success) {
        if (result.id)
          setCopySuccess(`Direct upload successful. CID: ${result.id}`);
        else setCopySuccess(result.message || "Direct upload successful");
      } else {
        setUploadError(result.error || "Upload failed with unknown error");
      }
      setTimeout(() => {
        setCopySuccess(null);
        setUploadError(null);
      }, 5000);
    } catch (error) {
      console.error("Error in direct upload test:", error);
      setUploadError(
        `Direct upload test failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      setTimeout(() => setUploadError(null), 5000);
    }
  };

  const testWakuMessage = async () => {
    if (!isWakuConnected) {
      setUploadError("Waku is not connected. Please check your connection.");
      addWakuDebugLog("error", "Waku is not connected");
      setTimeout(() => setUploadError(null), 5000);
      return;
    }
    try {
      addWakuDebugLog("info", "Sending test message via Waku...");
      const timestamp = Date.now();
      const testFileName = `test-message-${timestamp}.txt`;
      const testFileId = `test-${timestamp}`; // This is a placeholder, not a real CID
      addWakuDebugLog(
        "info",
        `Created test message: ${testFileName} (ID: ${testFileId})`
      );

      const success = await sendFileMessage({
        fileName: testFileName,
        fileSize: 0.01, // MB
        fileType: "text/plain",
        fileId: testFileId, // Using placeholder ID for test
      });

      if (success) {
        setCopySuccess(`Test message sent successfully: ${testFileName}`);
        addWakuDebugLog("success", `Message sent: ${testFileName}`);
      } else {
        setUploadError("Failed to send test message");
        addWakuDebugLog("error", "Failed to send test message");
      }
      setTimeout(() => {
        setCopySuccess(null);
        setUploadError(null);
      }, 3000);
    } catch (error) {
      console.error("Error sending test Waku message:", error);
      setUploadError(
        `Test message failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      addWakuDebugLog(
        "error",
        `Test message failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      setTimeout(() => setUploadError(null), 5000);
    }
  };

  const handleCopyFileCid = (fileId: string) => {
    // fileId here is the FileItem.id
    const file =
      sentFiles.find((f) => f.id.toString() === fileId) ||
      receivedFiles.find((f) => f.id.toString() === fileId);
    if (file && file.fileId) {
      // Check for actual fileId (CID)
      console.log("Copying file CID:", {
        fileId: fileId,
        file: file,
        cid: file.fileId,
      });
      const cidToDisplay = `${file.fileId.substring(
        0,
        8
      )}...${file.fileId.substring(file.fileId.length - 6)}`;
      const success = copyToClipboard(file.fileId);
      if (success) {
        setCopiedFileCid(fileId);
        setCopySuccess(`CID copied to clipboard: ${cidToDisplay}`);
        console.log(`Copied CID to clipboard: ${file.fileId}`);
        setTimeout(() => {
          setCopiedFileCid(null);
          setCopySuccess(null);
        }, 2000);
      } else {
        console.error("Failed to copy CID to clipboard");
        setUploadError("Failed to copy CID to clipboard");
        setTimeout(() => setUploadError(null), 5000);
      }
    } else {
      console.warn("No CID found for file:", fileId);
      setUploadError("No CID available for this file");
      setTimeout(() => setUploadError(null), 5000);
    }
  };

  const handleDownloadFile = async (fileId: string) => {
    // fileId is FileItem.id
    const file =
      sentFiles.find((f) => f.id.toString() === fileId) ||
      receivedFiles.find((f) => f.id.toString() === fileId);
    if (!file) {
      setUploadError("File not found");
      setTimeout(() => setUploadError(null), 5000);
      return;
    }
    if (!file.fileId) {
      // Check for actual fileId (CID)
      setUploadError("File ID (CID) not found for download");
      setTimeout(() => setUploadError(null), 5000);
      return;
    }

    try {
      setCopySuccess(`Fetching file metadata for ${file.name}...`); // More descriptive
      if (file.isEncrypted) {
        if (!walletConnected || !signer) {
          setUploadError(
            "You need to connect your wallet to decrypt this file"
          );
          setTimeout(() => setUploadError(null), 5000);
          return;
        }
        setCopySuccess(
          `File "${file.name}" is encrypted, preparing for decryption...`
        );
        setDecryptionInProgress((prev) => ({ ...prev, [file.fileId!]: true }));
        setDecryptionError(null);

        setCopySuccess(`Fetching encrypted file (${file.name}) from Codex...`);
        const encryptedFileResult = await downloadFile(file.fileId); // downloadFile is from useCodex
        if (!encryptedFileResult.success || !encryptedFileResult.data) {
          throw new Error(
            encryptedFileResult.error ||
              "Failed to download encrypted file data"
          );
        }

        const encryptedArrayBuffer =
          await encryptedFileResult.data.arrayBuffer();
        const encryptedBytes = new Uint8Array(encryptedArrayBuffer);

        try {
          if (!signer) {
            // Should be caught by walletConnected check, but good to be sure
            setUploadError("Wallet signer not available for decryption.");
            setTimeout(() => setUploadError(null), 5000);
            return;
          }
          setCopySuccess(`Decrypting encrypted file (${file.name})...`);
          const decryptedBytes = await decryptDataFromBytes(
            encryptedBytes,
            signer
          ); // from useTaco

          if (decryptedBytes) {
            const originalBytes = new Uint8Array(decryptedBytes);
            setCopySuccess(`Downloading decrypted ${file.name}...`);
            const blob = new Blob([originalBytes], {
              type: file.type || "application/octet-stream",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = file.name; // Use original file name
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            setCopySuccess(`Decrypted and downloaded ${file.name}`);
          } else {
            throw new Error("Decryption returned no data");
          }
        } catch (decryptErr) {
          console.error("Decryption failed:", decryptErr);
          const errMsg =
            decryptErr instanceof Error
              ? decryptErr.message
              : String(decryptErr);
          const displayMsg = errMsg.includes("Threshold of responses not met")
            ? "Access denied. Threshold of responses not met."
            : errMsg;
          setDecryptionError(displayMsg);
          setUploadError(`Failed to decrypt: ${displayMsg}`);
          setTimeout(() => {
            setDecryptionError(null);
            setUploadError(null);
          }, 5000);
        } finally {
          setDecryptionInProgress((prev) => ({
            ...prev,
            [file.fileId!]: false,
          }));
        }
      } else {
        // File is not encrypted
        setCopySuccess(`Fetching file metadata for ${file.name}...`);
        const result = await downloadFile(file.fileId); // downloadFile from useCodex
        if (!result.success || !result.data || !result.metadata) {
          throw new Error(result.error || "Failed to download file");
        }
        const {
          data: blob,
          metadata: { filename, mimetype },
        } = result;
        setCopySuccess(`Downloading ${filename || file.name}...`);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename || file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setCopySuccess(
          `File "${filename || file.name}" downloaded successfully`
        );
      }
      setTimeout(() => setCopySuccess(null), 3000);
    } catch (error) {
      console.error("Error downloading file:", error);
      let errorMessage = "Failed to download file";
      if (axios.isAxiosError(error)) {
        // Check if it's an Axios error if you use axios in downloadFile
        errorMessage += `: ${error.response?.status || ""} ${error.message}`;
        console.error("API error details:", error.response?.data);
      } else if (error instanceof Error) {
        errorMessage += `: ${error.message}`;
      }
      setUploadError(errorMessage);
      setTimeout(() => setUploadError(null), 5000);
    }
  };

  // --- MODIFIED: Pyodide Modal & Email Proof Logic ---
  const handleViewPyFile = async (fileItemId: string) => {
    const file = receivedFiles.find((f) => f.id.toString() === fileItemId);
    if (!file || !file.fileId) {
      setUploadError("File or File ID not found for viewing.");
      setTimeout(() => setUploadError(null), 5000);
      return;
    }

    if (decryptionInProgress[file.fileId]) {
      setUploadError("File processing in progress, please wait.");
      setTimeout(() => setUploadError(null), 5000);
      return;
    }

    try {
      setCopySuccess(`Fetching ${file.name} for viewing...`);
      setSelectedPyFileForView(file);
      setPyodideOutput([]);
      setSelectedDataFiles(null);
      setPyodideOutputFilePath(null);
      setComputationSecret(null); // Reset secret when opening modal
      setSelectedEmlFileForProof(null); // Reset EML for proof
      if (pyFileInputRef.current) pyFileInputRef.current.value = "";

      let fileDataBlob: Blob | undefined;

      if (file.isEncrypted) {
        // ... (existing decryption logic for viewing) ...
        if (!walletConnected || !signer) {
          setUploadError("Connect your wallet to view encrypted Python files.");
          setTimeout(() => setUploadError(null), 5000);
          setSelectedPyFileForView(null);
          setCopySuccess(null);
          return;
        }
        setDecryptionInProgress((prev) => ({ ...prev, [file.fileId!]: true }));
        setDecryptionError(null);
        const encryptedFileResult = await downloadFile(file.fileId);
        if (!encryptedFileResult.success || !encryptedFileResult.data) {
          throw new Error(
            encryptedFileResult.error ||
              "Failed to download encrypted file data for viewing"
          );
        }
        const encryptedArrayBuffer =
          await encryptedFileResult.data.arrayBuffer();
        const encryptedBytes = new Uint8Array(encryptedArrayBuffer);
        try {
          const decryptedBytes = await decryptDataFromBytes(
            encryptedBytes,
            signer
          );
          if (decryptedBytes) {
            fileDataBlob = new Blob([new Uint8Array(decryptedBytes)], {
              type: "text/plain",
            });
          } else {
            throw new Error("Decryption returned no data for viewing");
          }
        } catch (decryptErr) {
          // ... (error handling) ...
          const errMsg =
            decryptErr instanceof Error
              ? decryptErr.message
              : String(decryptErr);
          const displayMsg = errMsg.includes("Threshold of responses not met")
            ? "Access denied for viewing. Threshold not met."
            : errMsg;
          setDecryptionError(displayMsg);
          setUploadError(`Failed to decrypt for viewing: ${displayMsg}`);
          setTimeout(() => {
            setDecryptionError(null);
            setUploadError(null);
          }, 5000);
          setSelectedPyFileForView(null);
          setCopySuccess(null);
          return;
        } finally {
          setDecryptionInProgress((prev) => ({
            ...prev,
            [file.fileId!]: false,
          }));
        }
      } else {
        const result = await downloadFile(file.fileId);
        if (!result.success || !result.data) {
          throw new Error(
            result.error || "Failed to download Python file content for viewing"
          );
        }
        fileDataBlob = result.data;
      }

      if (fileDataBlob) {
        const textContent = await fileDataBlob.text();
        setPyFileContent(textContent);
        setIsViewPyModalOpen(true);
      } else {
        throw new Error("Could not retrieve file content for viewing.");
      }
      setCopySuccess(null);
    } catch (error) {
      console.error("Error viewing Python file:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      setUploadError(`Failed to view Python file: ${errorMessage}`);
      setTimeout(() => setUploadError(null), 5000);
      setSelectedPyFileForView(null);
      setCopySuccess(null);
    }
  };

  const handleRunPyScriptInModal = async () => {
    if (!pyodide || !isPyodideReady) {
      setPyodideOutput((prev) => [...prev, "Error: Pyodide is not ready."]);
      return;
    }
    if (!selectedPyFileForView || !pyFileContent) {
      setPyodideOutput((prev) => [
        ...prev,
        "Error: No Python script content loaded.",
      ]);
      return;
    }
    if (!selectedDataFiles || selectedDataFiles.length === 0) {
      setPyodideOutput((prev) => [...prev, "Error: No data files selected."]);
      return;
    }

    setIsScriptRunning(true);
    setPyodideOutputFilePath(null);
    setComputationSecret(null); // Reset secret before new run
    setPyodideOutput([`Running script: ${selectedPyFileForView.name}...`]);

    try {
      // ... (existing Pyodide file loading and execution logic) ...
      setPyodideOutput((prev) => [
        ...prev,
        "Loading data files into virtual environment...",
      ]);
      for (const file of Array.from(selectedDataFiles)) {
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const filePath = `/home/${file.name}`; // Pyodide virtual FS path
        try {
          pyodide.FS.mkdir("/home");
        } catch (e) {
          /* ignore if dir exists */
        }
        pyodide.FS.writeFile(filePath, uint8Array);
        setPyodideOutput((prev) => [
          ...prev,
          `Loaded ${file.name} into FS at ${filePath}`,
        ]);
      }

      setPyodideOutput((prev) => [
        ...prev,
        "Analyzing script for required packages...",
      ]);
      await pyodide.loadPackagesFromImports(pyFileContent);
      setPyodideOutput((prev) => [...prev, "Packages loaded (if any)."]);

      pyodide.setStdout({
        batched: (msg: string) => {
          setPyodideOutput((prev) => [...prev, `[stdout] ${msg}`]);
        },
      });
      pyodide.setStderr({
        batched: (msg: string) => {
          setPyodideOutput((prev) => [...prev, `[stderr] ${msg}`]);
        },
      });

      setPyodideOutput((prev) => [...prev, "Executing Python script..."]);
      const result = await pyodide.runPythonAsync(pyFileContent);
      setPyodideOutput((prev) => [...prev, `Script execution finished.`]);
      if (result !== undefined) {
        setPyodideOutput((prev) => [...prev, `Result: ${String(result)}`]);
      }

      const randomBytes = new Uint8Array(16);
      window.crypto.getRandomValues(randomBytes);

      // Convert to hex string for display/storage
      const newSecret = Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      setComputationSecret(newSecret);
      // Store script hash associated with this run, if the file item doesn't have it yet
      if (selectedPyFileForView && !selectedPyFileForView.scriptHash) {
        const hash = await calculateSha256(pyFileContent) + newSecret;
        setSelectedPyFileForView((prev) =>
          prev ? { ...prev, scriptHash: hash } : null
        );
      }
      setPyodideOutput((prev) => [
        ...prev,
        `------------------------------------------------------------`,
      ]);
      setPyodideOutput((prev) => [
        ...prev,
        `✅ COMPUTATION SECRET GENERATED: ${newSecret}`,
      ]);
      setPyodideOutput((prev) => [
        ...prev,
        `   Keep this secret safe. You'll need it for the email proof.`,
      ]);
      setPyodideOutput((prev) => [
        ...prev,
        `------------------------------------------------------------`,
      ]);

      // Check for conventional output file (same as before)
      const conventionalOutputPath =
        "/home/pyodide/fNIRS_Glucose_Analysis_Output_v17_carol_2_files_home_file_output/processing_log_v17_carol_2_files_home_file_output.txt";
      if (pyodide.FS.analyzePath(conventionalOutputPath).exists) {
        setPyodideOutput((prev) => [
          ...prev,
          `Output file detected: ${conventionalOutputPath}`,
        ]);
        setPyodideOutputFilePath(conventionalOutputPath);
        const outputContent = pyodide.FS.readFile(conventionalOutputPath, {
          encoding: "utf8",
        });
        setPyodideOutput((prev) => [
          ...prev,
          `--- Content of ${conventionalOutputPath} ---`,
          outputContent,
          `--- End of ${conventionalOutputPath} ---`,
        ]);
      } else {
        setPyodideOutput((prev) => [
          ...prev,
          `No conventional output file (${conventionalOutputPath}) found.`,
        ]);
        setPyodideOutputFilePath(null);
      }
    } catch (error) {
      console.error("Error running Python script:", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      setPyodideOutput((prev) => [...prev, `Execution Error: ${errorMsg}`]);
      setPyodideOutputFilePath(null);
      setComputationSecret(null); // Clear secret on error
    } finally {
      setIsScriptRunning(false);
    }
  };

  const handleOpenProofSubmissionModal = async () => {
    if (
      !selectedPyFileForView ||
      !pyFileContent ||
      !computationSecret ||
      !walletAddress
    ) {
      setUploadError(
        "Missing data for proof submission. Ensure script ran, secret is generated, and wallet is connected."
      );
      setTimeout(() => setUploadError(null), 5000);
      return;
    }
    const hash = await calculateSha256(pyFileContent) + computationSecret;
    setSelectedPyFileForView((prev) => (prev ? { ...prev, scriptHash: hash } : null));

    const subject = `Claim reward for running the computation on my private data`;
    const bodyInstruction = `Please ensure the BODY of your email contains ONLY the following hash:\n\n${hash}`;

    setEmailProofSubject(subject);
    setEmailProofBodyInstruction(bodyInstruction);
    setSelectedEmlFileForProof(null); // Reset selected .eml file
    
    // Close the script preview dialog when opening the email proof submission dialog
    setIsViewPyModalOpen(false);
    setIsProofSubmissionModalOpen(true);
  };

  const handleSubmitEmailProof = async () => {
    if (
      !selectedPyFileForView?.scriptHash ||
      !computationSecret ||
      !pyFileContent
    ) {
      setUploadError(
        "Missing required data for proof submission: .eml file, script hash, or secret."
      );
      setTimeout(() => setUploadError(null), 5000);
      return;
    }
    if (!walletConnected || !walletAddress) {
      setUploadError("Please connect your wallet before submitting proof.");
      setTimeout(() => setUploadError(null), 5000);
      return;
    }

    setIsSubmittingEmailProof(true);
    setUploadError(null);
    setCopySuccess(null);

    try {
      const emlContent = await selectedEmlFileForProof.text();

      const payload = {
        emlMimeContent: emlContent,
        originalScriptContent: pyFileContent, // Send full script content
        workerProvidedSecret: computationSecret,
        // The payoutWallet will be extracted from the email subject by the prover
      };

      // console.log("Submitting to backend /api/submit-email-computation-proof:", payload);

      const response = await axios.post(
        "/api/submit-email-computation-proof",
        payload,
        {
          headers: { "Content-Type": "application/json" },
        }
      );

      if (response.data.success) {
        setCopySuccess(
          `Email proof submitted successfully! Tx: ${
            response.data.transactionHash
              ? response.data.transactionHash.substring(0, 10) + "..."
              : "N/A"
          }`
        );
        setIsProofSubmissionModalOpen(false);
        // Optionally reset relevant states
        setComputationSecret(null);
        setSelectedEmlFileForProof(null);
      } else {
        setUploadError(
          `Proof submission failed: ${
            response.data.error || "Unknown backend error"
          }`
        );
      }
    } catch (error: any) {
      console.error("Error submitting email proof:", error);
      const errMsg =
        error.response?.data?.error ||
        error.message ||
        "An unknown error occurred during proof submission.";
      setUploadError(`Proof submission error: ${errMsg}`);
    } finally {
      setIsSubmittingEmailProof(false);
      setTimeout(() => {
        setUploadError(null);
        setCopySuccess(null);
      }, 7000);
    }
  };

  // ... (rest of your existing handleUploadPyodideOutput, handleCodexUrlChange, handleSaveConfig, etc.)
  const handleUploadPyodideOutput = async () => {
    if (
      !pyodide ||
      !isPyodideReady ||
      !pyodideOutputFilePath ||
      !isCodexNodeActive
    ) {
      setUploadError(
        "Cannot upload output: System not ready or no output file detected."
      );
      setTimeout(() => setUploadError(null), 5000);
      return;
    }

    setIsUploadingPyodideOutput(true);
    setPyodideOutputUploadProgress(0);
    const outputFileName =
      pyodideOutputFilePath.split("/").pop() ||
      `pyodide_output_${Date.now()}.txt`;

    try {
      setCopySuccess(`Preparing to upload ${outputFileName}...`);
      const fileContentUint8Array = pyodide.FS.readFile(pyodideOutputFilePath, {
        encoding: "binary",
      });
      const outputFileBlob = new Blob([fileContentUint8Array], {
        type: "application/octet-stream",
      });
      const outputFile = new globalThis.File([outputFileBlob], outputFileName, {
        type: outputFileBlob.type,
      });

      const client = getCodexClient();
      const result = await client.uploadFile(outputFile, (progress: number) => {
        setPyodideOutputUploadProgress(progress);
      });

      if (result.success && result.id) {
        const timestamp = new Date().toLocaleString("en-US", {
          /* format options */
        });
        const newFile: FileItem = {
          id: `pyodide-output-${Date.now()}`,
          name: outputFile.name,
          isEncrypted: false,
          size: parseFloat((outputFile.size / (1024 * 1024)).toFixed(2)),
          type: outputFile.type,
          timestamp,
          fileId: result.id,
        };
        setSentFiles((prev) => [newFile, ...prev]);
        setCopySuccess(
          `Successfully uploaded ${outputFile.name}. CID: ${result.id.substring(
            0,
            8
          )}...`
        );

        if (isWakuConnected) {
          await sendFileMessage({
            fileName: newFile.name,
            fileSize: newFile.size,
            fileType: newFile.type,
            fileId: result.id,
            isEncrypted: false,
          });
        }
      } else {
        setUploadError(
          `Failed to upload ${outputFile.name}: ${
            result.error || "Unknown upload error"
          }`
        );
      }
    } catch (error) {
      console.error("Error uploading Pyodide output:", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      setUploadError(`Error uploading script output: ${errorMsg}`);
    } finally {
      setIsUploadingPyodideOutput(false);
      setPyodideOutputUploadProgress(0);
      setTimeout(() => {
        setUploadError(null);
        setCopySuccess(null);
      }, 5000);
    }
  };

  const handleCodexUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setCodexNodeUrl(event.target.value);
  };

  const handleSaveConfig = () => {
    if (
      codexEndpointType === "local" &&
      (!codexNodeUrl.trim() || !codexNodeUrl.startsWith("http"))
    ) {
      alert(
        "Please enter a valid URL starting with http:// or https:// for local Codex node."
      );
      return;
    }
    setIsSaving(true);
    // Determine the URL to use based on endpoint type
    const urlToUse =
      codexEndpointType === "remote"
        ? process.env.NEXT_PUBLIC_CODEX_REMOTE_API_URL || "" // Fallback for remote
        : codexNodeUrl;

    updateCodexConfig(urlToUse, codexEndpointType);
    // Waku config update would go here if useWaku hook supported it directly
    setSaveSuccess(true);
    setTimeout(() => {
      setIsSaving(false);
      setSaveSuccess(false);
    }, 2000);
  };

  const clearSenderIds = () => {
    sessionStorage.removeItem("wakuSenderId");
    sessionStorage.removeItem("wakuTabId");
    localStorage.removeItem("wakuUserId");
    addWakuDebugLog("info", "All sender IDs cleared");
    setCopySuccess("All sender IDs cleared");
    setTimeout(() => setCopySuccess(null), 3000);
  };

  const renderNodeInfo = () => {
    if (!nodeInfo || !isValidNodeInfo(nodeInfo)) return null; // Or some placeholder
    return (
      <div className="p-4 bg-muted rounded-lg text-xs font-mono mt-4 border border-border">
        <h4 className="font-semibold mb-2 text-primary/90">CODEX_NODE_INFO:</h4>
        <p>
          <span className="text-muted-foreground">ID:</span>{" "}
          {nodeInfo.id || "N/A"}
        </p>
        <p>
          <span className="text-muted-foreground">Version:</span>{" "}
          {nodeInfo.version}
        </p>
        <p>
          <span className="text-muted-foreground">Revision:</span>{" "}
          {nodeInfo.revision ?? "N/A"}
        </p>
        <p>
          <span className="text-muted-foreground">Status:</span>{" "}
          {nodeInfo.status}
        </p>
        <p>
          <span className="text-muted-foreground">Uptime:</span>{" "}
          {nodeInfo.uptime}
        </p>
        {nodeInfo.peers !== undefined && (
          <p>
            <span className="text-muted-foreground">Peers:</span>{" "}
            {nodeInfo.peers}
          </p>
        )}
      </div>
    );
  };

  const handleEndpointTypeChange = (type: "remote" | "local") => {
    setCodexEndpointType(type);
    // Automatically update the URL input when type changes
    const newUrl =
      type === "remote"
        ? process.env.NEXT_PUBLIC_CODEX_REMOTE_API_URL || ""
        : process.env.NEXT_PUBLIC_CODEX_LOCAL_API_URL ||
          "http://localhost:8080/api/codex";
    setCodexNodeUrl(newUrl);
    // Optionally, immediately apply this change or wait for save
    updateCodexConfig(newUrl, type);
  };

  return (
    <TooltipProvider>
      <div
        className={`flex min-h-screen flex-col ${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <Head>
          <title>CypherShare - Decentralized File Sharing & Computation</title>
          <meta
            name="description"
            content="Securely share files and prove computations using Codex, Waku, TACo, and vLayer Email Proofs."
          />
          {/* ... other meta tags ... */}
          <link rel="icon" href="/favicon.ico" />
        </Head>

        {/* ... existing copySuccess and uploadError toasts ... */}
        {copySuccess && (
          <div className="fixed bottom-4 right-4 p-3 bg-green-500/20 border border-green-500/30 rounded-md shadow-lg z-50 max-w-md terminal-glow">
            <p className="text-xs text-green-500 font-mono flex items-center gap-1">
              <Check size={12} /> {copySuccess}
            </p>
          </div>
        )}
        {uploadError && (
          <div className="fixed bottom-4 right-4 p-3 bg-amber-600/20 border border-amber-600/30 rounded-md shadow-lg z-50 max-w-md terminal-glow">
            <p className="text-xs text-amber-600/90 font-mono flex items-center gap-1">
              <AlertCircle size={12} /> {uploadError}
            </p>
          </div>
        )}

        {/* Pyodide Modal (View & Run Script) */}
        {isViewPyModalOpen && selectedPyFileForView && (
          <Dialog
            open={isViewPyModalOpen}
            onOpenChange={(isOpen) => {
              /* ... existing close logic ... */
              setIsViewPyModalOpen(isOpen);
              if (!isOpen) {
                setPyFileContent("");
                setSelectedPyFileForView(null);
                setPyodideOutput([]);
                setSelectedDataFiles(null);
                setPyodideOutputFilePath(null);
                if (pyFileInputRef.current) pyFileInputRef.current.value = "";
                setComputationSecret(null); // Reset secret on modal close
                setSelectedEmlFileForProof(null);
              }
            }}
          >
            <DialogContent className="sm:max-w-[700px] md:max-w-[900px] lg:max-w-[1100px] h-[90vh] flex flex-col bg-card border-border">
              <DialogHeader className="border-b border-border pb-3">
                <DialogTitle className="font-mono text-primary">
                  Run Script: {selectedPyFileForView.name}
                </DialogTitle>
                <DialogDescription className="font-mono text-muted-foreground">
                  Execute the Python script in a sandboxed Pyodide environment.
                </DialogDescription>
              </DialogHeader>

              {/* Script Content & Output Panes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-grow overflow-hidden min-h-0">
                {/* Script Content Pane */}
                <div className="flex flex-col overflow-hidden border border-input rounded-md p-1 bg-background">
                  <h3 className="text-sm font-mono text-center py-1 text-primary/80">
                    Script_Content
                  </h3>
                  <div className="flex-grow overflow-y-auto p-1">
                    <pre className="text-xs font-mono whitespace-pre-wrap break-all p-2 text-foreground">
                      {pyFileContent}
                    </pre>
                  </div>
                </div>
                {/* Execution Output Pane */}
                <div className="flex flex-col overflow-hidden border border-input rounded-md p-1 bg-background">
                  <h3 className="text-sm font-mono text-center py-1 text-primary/80">
                    Execution_Output_&_Logs
                  </h3>
                  <div className="flex-grow overflow-y-auto p-1 mb-2 text-xs font-mono whitespace-pre-wrap break-all bg-muted/30 rounded min-h-[100px]">
                    {/* ... Pyodide loading and output messages ... */}
                    {pyodideLoadingMessage && !isPyodideReady && (
                      <p className="p-2 text-amber-500">
                        {pyodideLoadingMessage}
                      </p>
                    )}
                    {isPyodideReady &&
                      pyodideLoadingMessage ===
                        "Pyodide loaded successfully." &&
                      pyodideOutput.length === 0 && (
                        <p className="p-2 text-green-500">
                          Pyodide is ready. Select data file(s) and run script.
                        </p>
                      )}
                    {pyodideOutput.map((line, index) => (
                      <p
                        key={index}
                        className={`p-1 ${
                          line.startsWith("[stderr]") ||
                          line.startsWith("Execution Error:")
                            ? "text-destructive"
                            : line.includes("COMPUTATION SECRET GENERATED")
                            ? "text-green-400 font-bold"
                            : "text-foreground/80"
                        }`}
                      >
                        {line}
                      </p>
                    ))}
                    {isScriptRunning && (
                      <p className="p-2 text-primary animate-pulse">
                        Script is running...
                      </p>
                    )}
                    {isUploadingPyodideOutput && (
                      <p className="p-2 text-primary animate-pulse">
                        Uploading output: {pyodideOutputUploadProgress}%
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <DialogFooter className="mt-2 pt-3 border-t border-border items-center flex-wrap gap-2 justify-end">
                <div className="flex-grow text-xs text-muted-foreground font-mono mr-auto w-full sm:w-auto mb-2 sm:mb-0">
                  {selectedDataFiles
                    ? `${selectedDataFiles.length} data file(s) selected`
                    : "No data files selected"}
                  {pyodideOutputFilePath &&
                    ` | Output: ${pyodideOutputFilePath.split("/").pop()}`}
                </div>
                <div className="flex gap-2 flex-wrap justify-end">
                  <Button
                    variant="outline"
                    className="font-mono"
                    onClick={() => pyFileInputRef.current?.click()}
                  >
                    Choose Data File(s)
                  </Button>
                  <input
                    type="file"
                    ref={pyFileInputRef}
                    className="hidden"
                    multiple
                    onChange={(e) => {
                      /* ... existing logic ... */
                      if (e.target.files && e.target.files.length > 0) {
                        const files = e.target.files;
                        setSelectedDataFiles(files);
                        setCopySuccess(
                          files.length === 1
                            ? `Selected data file: ${files[0].name}`
                            : `Selected ${files.length} data files.`
                        );
                        setTimeout(() => setCopySuccess(null), 3000);
                      } else {
                        setSelectedDataFiles(null);
                      }
                    }}
                  />

                  <Button
                    variant="default"
                    className="font-mono bg-primary hover:bg-primary/90"
                    onClick={handleRunPyScriptInModal}
                    disabled={
                      !isPyodideReady ||
                      isScriptRunning ||
                      !selectedDataFiles ||
                      selectedDataFiles.length === 0 ||
                      !pyFileContent ||
                      isUploadingPyodideOutput
                    }
                  >
                    {isScriptRunning ? "Running..." : "Run Script"}
                  </Button>

                  {pyodideOutputFilePath && (
                    <Button
                      variant="secondary"
                      className="font-mono"
                      onClick={handleUploadPyodideOutput}
                      disabled={
                        !isPyodideReady ||
                        isScriptRunning ||
                        !isCodexNodeActive ||
                        isUploadingPyodideOutput
                      }
                    >
                      {isUploadingPyodideOutput
                        ? `Uploading ${pyodideOutputUploadProgress}%...`
                        : "Upload Output"}
                    </Button>
                  )}

                  {computationSecret &&
                    selectedPyFileForView && ( // Show button if secret is generated
                      <Button
                        variant="destructive"
                        className="font-mono"
                        onClick={handleOpenProofSubmissionModal}
                        disabled={isSubmittingEmailProof || !walletConnected}
                      >
                        <Mail size={14} className="mr-2" /> Submit Email Proof
                      </Button>
                    )}

                  <DialogClose asChild>
                    <Button variant="outline" className="font-mono">
                      Close
                    </Button>
                  </DialogClose>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* NEW: Email Proof Submission Modal */}
        {isProofSubmissionModalOpen && (
          <Dialog
            open={isProofSubmissionModalOpen}
            onOpenChange={(isOpen) => {
              setIsProofSubmissionModalOpen(isOpen);
              if (!isOpen) {
                setSelectedEmlFileForProof(null); // Reset EML file on close
                if (proofEmlFileInputRef.current)
                  proofEmlFileInputRef.current.value = "";
              }
            }}
          >
            <DialogContent className="sm:max-w-lg bg-card border-border">
              <DialogHeader className="border-b border-border pb-3">
                <DialogTitle className="font-mono text-primary flex items-center gap-2">
                  <Mail size={18} />
                  Submit Computation Email Proof
                </DialogTitle>
                <DialogDescription className="font-mono text-muted-foreground">
                  To finalize your computation claim, please prepare and upload
                  an .eml file.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4 text-sm font-mono">
                <p className="text-foreground/90">
                  1. <strong className="text-primary">Compose an Email:</strong>
                </p>
                <div className="ml-4 p-3 bg-muted/50 border border-input rounded-md space-y-1">
                  <p>
                    <strong className="text-muted-foreground">From:</strong>{" "}
                    Your DKIM-verifiable email address.
                  </p>
                  <p>
                    <strong className="text-muted-foreground">To:</strong> (Can
                    be yourself or any address, you'll download the .eml)
                  </p>
                  <div>
                    <strong className="text-muted-foreground">
                      Subject (Exact):
                    </strong>
                    <div className="mt-1 p-2 bg-background border border-input rounded text-xs text-primary break-all flex items-center gap-2">
                      <span>{emailProofSubject}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => {
                          copyToClipboard(emailProofSubject);
                          setCopySuccess("Subject copied!");
                          setTimeout(() => setCopySuccess(null), 1500);
                        }}
                      >
                        <Copy size={12} />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <strong className="text-muted-foreground">
                      Body (Exact - Plain Text):
                    </strong>
                    <div className="mt-1 p-2 bg-background border border-input rounded text-xs text-primary break-all flex items-center gap-2">
                      <span>{computationSecret}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => {
                          copyToClipboard(computationSecret || "");
                          setCopySuccess("Secret copied!");
                          setTimeout(() => setCopySuccess(null), 1500);
                        }}
                      >
                        <Copy size={12} />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      {emailProofBodyInstruction
                        .split("\n")
                        .slice(1)
                        .join("\n")}
                    </p>
                  </div>
                </div>
                <p className="text-foreground/90">
                  2.{" "}
                  <strong className="text-primary">
                    Send & Download .eml:
                  </strong>{" "}
                  Send the email, then download it as an `.eml` file from your
                  sent folder or inbox (look for "Show original", "Download
                  message", or "Save as").
                </p>
                <p className="text-foreground/90">
                  3. <strong className="text-primary">Upload .eml File:</strong>
                </p>
                <div className="ml-4">
                  <Input
                    type="file"
                    accept=".eml"
                    ref={proofEmlFileInputRef}
                    className="font-mono text-sm file:text-primary file:font-mono"
                    onChange={(e) =>
                      setSelectedEmlFileForProof(
                        e.target.files ? e.target.files[0] : null
                      )
                    }
                  />
                  {selectedEmlFileForProof && (
                    <p className="text-xs text-green-400 mt-1">
                      Selected: {selectedEmlFileForProof.name}
                    </p>
                  )}
                </div>
              </div>
              <DialogFooter className="mt-2 pt-3 border-t border-border">
                <Button
                  variant="outline"
                  className="font-mono"
                  onClick={() => setIsProofSubmissionModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="font-mono"
                  onClick={handleSubmitEmailProof}
                  disabled={
                    !selectedEmlFileForProof ||
                    isSubmittingEmailProof ||
                    !walletConnected
                  }
                >
                  {isSubmittingEmailProof ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 rounded-full border-2 border-t-transparent border-current animate-spin"></span>
                      Submitting...
                    </span>
                  ) : (
                    <>
                      <Send size={14} className="mr-2" /> Submit Proof
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Main application layout */}
        <main className="flex-1 flex flex-col p-4 md:p-8 relative z-0">
          <div className="w-full max-w-5xl mx-auto flex flex-col">
            {/* ... existing header and room ID section ... */}
            <div className="flex flex-col md:flex-row items-center justify-between mb-4 pb-4 gap-4">
              <div className="flex items-center gap-3 group md:w-1/4">
                <div className="p-2 rounded-lg bg-primary/15 shadow-sm group-hover:bg-primary/20 transition-all duration-300 border border-primary/10">
                  <Waypoints
                    size={22}
                    className="text-primary group-hover:scale-110 transition-transform duration-300"
                  />
                </div>
                <div className="flex items-center">
                  <span className="font-bold text-lg tracking-tight font-mono">
                    CypherShare
                  </span>
                </div>
                <div className="hidden md:flex items-center h-6 px-2.5 rounded-full bg-muted/60 border border-border text-xs font-medium text-muted-foreground font-mono">
                  alpha
                </div>
              </div>

              <div className="flex items-center justify-center md:w-2/4 w-full">
                <div className="inline-flex items-center gap-2 border border-border rounded-md px-4 py-2 bg-card shadow-sm w-full md:max-w-[350px] relative overflow-hidden">
                  <span className="text-sm font-medium text-secondary-foreground whitespace-nowrap font-mono">
                    Room ID:
                  </span>
                  <div className="relative w-full md:w-[180px]">
                    <Input
                      value={roomId}
                      onChange={(e) => setRoomId(e.target.value)}
                      disabled={!isEditingRoom}
                      className={`h-8 font-mono text-base px-3 ${
                        isEditingRoom
                          ? "border-primary ring-1 ring-primary/30"
                          : ""
                      } bg-opacity-70`}
                    />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsEditingRoom(!isEditingRoom)}
                      className="h-8 w-8 p-0 hover:bg-accent text-accent-foreground"
                      aria-label={
                        isEditingRoom ? "Save room ID" : "Edit room ID"
                      }
                    >
                      {isEditingRoom ? (
                        <Check size={16} className="text-primary" />
                      ) : (
                        <Edit size={16} />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyRoomId}
                      className="h-8 w-8 p-0 hover:bg-accent text-accent-foreground"
                      aria-label="Copy room ID"
                    >
                      {copiedRoom ? (
                        <Check size={16} className="text-green-500" />
                      ) : (
                        <Copy size={16} />
                      )}
                    </Button>
                  </div>
                  {wakuNodeType === "light" && (
                    <div
                      className={`absolute top-1 right-1 w-2 h-2 rounded-full ${
                        isWakuConnected
                          ? "bg-green-500 animate-pulse"
                          : isWakuConnecting
                          ? "bg-amber-500 animate-pulse"
                          : "bg-red-500"
                      }`}
                      title={
                        isWakuConnected
                          ? `Connected to Waku network (${wakuPeerCount} peers)`
                          : isWakuConnecting
                          ? "Connecting to Waku network..."
                          : "Not connected to Waku network"
                      }
                    />
                  )}
                  <div className="absolute inset-0 pointer-events-none opacity-10 bg-scanline"></div>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0 md:w-1/4 md:justify-end">
                <a
                  href="https://github.com/hackyguru/cyphershare"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2.5 rounded-full hover:bg-accent/80 hover:scale-105 transition-all duration-200 flex items-center justify-center border border-primary/20"
                  aria-label="View on GitHub"
                >
                  <Github size={20} className="text-primary" />
                </a>
                <WalletConnectButton />
                <Sheet>
                  <SheetTrigger asChild>
                    <button
                      className="p-2.5 rounded-full hover:bg-accent/80 hover:scale-105 transition-all duration-200 flex items-center justify-center relative border border-primary/20"
                      aria-label="Open settings"
                    >
                      <Settings size={20} className="text-primary" />
                    </button>
                  </SheetTrigger>
                  <SheetContent side="right" className="p-5 flex flex-col">
                    {/* ... existing settings sheet content ... */}
                    <div className="absolute inset-0 pointer-events-none opacity-10 bg-scanline"></div>
                    <SheetHeader className="px-1 pb-4 mb-6 border-b border-border">
                      <SheetTitle className="text-xl font-mono">
                        SYSTEM_CONFIG
                      </SheetTitle>
                      <SheetDescription className="text-sm text-muted-foreground font-mono">
                        Configure Codex, Waku and TACo settings
                      </SheetDescription>
                    </SheetHeader>

                    <div className="space-y-8 px-1 flex-1 overflow-y-auto">
                      {/* Codex Settings */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-md bg-primary/10">
                              <Server size={16} className="text-primary" />
                            </div>
                            <h3 className="text-base font-medium font-mono">
                              CODEX_SETTINGS
                            </h3>
                          </div>
                          {isCodexLoading ? (
                            <div
                              className="w-2 h-2 rounded-full bg-amber-700/70 animate-pulse"
                              title="Checking node status..."
                            ></div>
                          ) : isCodexNodeActive ? (
                            <div
                              className="w-2 h-2 rounded-full bg-green-500 animate-pulse"
                              title="Node is active"
                            ></div>
                          ) : (
                            <div
                              className="w-2 h-2 rounded-full bg-amber-600/80"
                              title="Node is not active"
                            ></div>
                          )}
                        </div>
                        <div className="space-y-4 pl-2 ml-2 border-l border-border">
                          {/* Endpoint Type Tabs */}
                          <div className="space-y-2">
                            <label className="text-sm font-medium font-mono">
                              ENDPOINT_TYPE
                            </label>
                            <Tabs
                              value={codexEndpointType}
                              onValueChange={(value) =>
                                handleEndpointTypeChange(
                                  value as "remote" | "local"
                                )
                              }
                              className="w-full"
                            >
                              <TabsList className="grid w-full grid-cols-2 font-mono">
                                <TabsTrigger value="remote">
                                  REMOTE_NODE
                                </TabsTrigger>
                                <TabsTrigger value="local">
                                  LOCAL_NODE
                                </TabsTrigger>
                              </TabsList>
                            </Tabs>
                            {codexEndpointType === "remote" && (
                              <div className="mt-2 p-2 bg-primary/10 border border-primary/20 rounded-md">
                                <p className="text-xs text-primary/90 font-mono flex items-center gap-1">
                                  <Info size={12} /> Use local Codex node for
                                  peak decentralization
                                </p>
                              </div>
                            )}
                          </div>
                          {/* API Endpoint Input */}
                          <div className="space-y-2">
                            <label
                              htmlFor="codex-url"
                              className="text-sm font-medium font-mono"
                            >
                              API_ENDPOINT
                            </label>
                            {codexEndpointType === "local" ? (
                              <>
                                <Input
                                  id="codex-url"
                                  value={codexNodeUrl}
                                  onChange={handleCodexUrlChange}
                                  placeholder="http://localhost:8080/api/codex"
                                  className="font-mono text-sm bg-card/70"
                                />
                                <div className="flex items-center justify-between">
                                  <p className="text-xs text-muted-foreground font-mono">
                                    Local Codex node API endpoint URL
                                  </p>
                                  <div className="flex items-center gap-1">
                                    {isCodexNodeActive ? (
                                      <span className="text-xs text-green-500 font-mono flex items-center gap-1">
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500"></span>
                                        ACTIVE
                                      </span>
                                    ) : (
                                      <span className="text-xs text-amber-600/90 font-mono flex items-center gap-1">
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600/80"></span>
                                        {isCodexLoading
                                          ? "CHECKING"
                                          : "OFFLINE"}
                                      </span>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => checkCodexStatus(true)}
                                      className="h-6 w-6 p-0 rounded-full"
                                      title="Refresh node status"
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="12"
                                        height="12"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="lucide lucide-refresh-cw"
                                      >
                                        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                                        <path d="M21 3v5h-5"></path>
                                        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                                        <path d="M3 21v-5h5"></path>
                                      </svg>
                                    </Button>
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="p-3 bg-card/70 rounded-lg border border-border">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm font-mono text-muted-foreground">
                                    Managed Codex endpoint
                                  </p>
                                  <div className="flex items-center gap-1">
                                    {isCodexNodeActive ? (
                                      <span className="text-xs text-green-500 font-mono flex items-center gap-1">
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500"></span>
                                        ACTIVE
                                      </span>
                                    ) : (
                                      <span className="text-xs text-amber-600/90 font-mono flex items-center gap-1">
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600/80"></span>
                                        {isCodexLoading
                                          ? "CHECKING"
                                          : "OFFLINE"}
                                      </span>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => checkCodexStatus(true)}
                                      className="h-6 w-6 p-0 rounded-full"
                                      title="Refresh node status"
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="12"
                                        height="12"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="lucide lucide-refresh-cw"
                                      >
                                        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                                        <path d="M21 3v5h-5"></path>
                                        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                                        <path d="M3 21v-5h5"></path>
                                      </svg>
                                    </Button>
                                  </div>
                                </div>
                                <p className="text-xs text-muted-foreground font-mono mt-2">
                                  Restrictions apply.{" "}
                                  <a
                                    href="https://github.com/hackyguru/cyphershare/docs/restrictions.md"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary hover:underline"
                                  >
                                    Know more
                                  </a>
                                </p>
                              </div>
                            )}
                            {codexError && (
                              <p className="text-xs text-amber-600/90 font-mono mt-1 flex items-center gap-1">
                                <AlertCircle size={12} /> Error: {codexError}
                              </p>
                            )}
                            {!isCodexNodeActive &&
                              !isCodexLoading &&
                              !codexError && (
                                <p className="text-xs text-amber-600/90 font-mono mt-1 flex items-center gap-1">
                                  <AlertCircle size={12} />
                                  Codex node is not running in the API endpoint
                                </p>
                              )}
                            {!isCodexNodeActive && !isCodexLoading && (
                              <div className="mt-2 p-2 bg-amber-600/20 border border-amber-600/30 rounded-md">
                                <p className="text-xs text-amber-600/90 font-mono flex items-center gap-1">
                                  <AlertCircle size={12} /> Turn off adblockers
                                  to avoid Codex node detection issues
                                </p>
                              </div>
                            )}
                            {isCodexNodeActive && nodeInfo && (
                              <div className="mt-3 p-2 bg-card/50 border border-primary/10 rounded-md">
                                <div className="flex items-center gap-1 mb-1">
                                  <Info size={12} className="text-primary/70" />
                                  <span className="text-xs font-medium text-primary/90 font-mono">
                                    NODE_INFO
                                  </span>
                                </div>
                                <div className="space-y-1 pl-4 border-l border-primary/10">
                                  <p className="text-xs font-mono flex items-center justify-between">
                                    <span className="text-muted-foreground">
                                      ID:
                                    </span>{" "}
                                    <span
                                      className="text-primary/80 truncate max-w-[180px]"
                                      title={nodeInfo.id}
                                    >
                                      {nodeInfo.id || "N/A"}
                                    </span>
                                  </p>
                                  <p className="text-xs font-mono flex items-center justify-between">
                                    <span className="text-muted-foreground">
                                      VERSION:
                                    </span>{" "}
                                    <span className="text-primary/80">
                                      {nodeInfo.version} (
                                      {nodeInfo.revision ?? "N/A"})
                                    </span>
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Waku Settings */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-md bg-primary/10">
                              <Radio size={16} className="text-primary" />
                            </div>
                            <h3 className="text-base font-medium font-mono">
                              WAKU_SETTINGS
                            </h3>
                          </div>
                          {wakuNodeType === "light" ? (
                            isWakuConnecting ? (
                              <div
                                className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"
                                title="Connecting to Waku network..."
                              ></div>
                            ) : isWakuConnected ? (
                              <div
                                className="w-2 h-2 rounded-full bg-green-500 animate-pulse"
                                title={`Connected to Waku network (${wakuPeerCount} peers)`}
                              ></div>
                            ) : (
                              <div
                                className="w-2 h-2 rounded-full bg-red-500"
                                title="Not connected to Waku network"
                              ></div>
                            )
                          ) : (
                            <div
                              className="w-2 h-2 rounded-full bg-primary/80"
                              title="Using relay node (config only)"
                            ></div>
                          )}
                        </div>
                        <div className="space-y-4 pl-2 ml-2 border-l border-border">
                          {/* Node Type Tabs */}
                          <div className="space-y-2">
                            <label className="text-sm font-medium font-mono">
                              NODE_TYPE
                            </label>
                            <Tabs
                              value={wakuNodeType}
                              onValueChange={setWakuNodeType}
                              className="w-full"
                            >
                              <TabsList className="grid w-full grid-cols-2 font-mono">
                                <TabsTrigger value="light">
                                  LIGHT_NODE
                                </TabsTrigger>
                                <TabsTrigger value="relay" disabled>
                                  RELAY_NODE
                                </TabsTrigger>{" "}
                                {/* Relay might be WIP */}
                              </TabsList>
                            </Tabs>
                            <p className="text-xs text-muted-foreground font-mono">
                              Select Waku node type (Light node recommended)
                            </p>
                            {wakuNodeType === "relay" && (
                              <div className="mt-2 p-2 bg-amber-600/20 border border-amber-600/30 rounded-md">
                                <p className="text-xs text-amber-600/90 font-mono flex items-center gap-1">
                                  <AlertCircle size={12} /> Relay node
                                  integration is not available yet
                                </p>
                              </div>
                            )}
                          </div>
                          {/* API Endpoint for Relay (if enabled) */}
                          {wakuNodeType === "relay" && (
                            <div className="space-y-2">
                              <label
                                htmlFor="waku-url"
                                className="text-sm font-medium font-mono"
                              >
                                API_ENDPOINT (Relay)
                              </label>
                              <Input
                                id="waku-url"
                                value={wakuNodeUrl}
                                onChange={(e) => setWakuNodeUrl(e.target.value)}
                                placeholder="http://127.0.0.1:8645"
                                className="font-mono text-sm bg-card/70"
                                disabled
                              />
                              <p className="text-xs text-muted-foreground font-mono">
                                nwaku node API endpoint URL (for relay mode)
                              </p>
                            </div>
                          )}
                          {wakuNodeType === "light" && (
                            <div className="mt-3 p-2 bg-card/50 border border-primary/10 rounded-md">
                              <div className="flex items-center gap-1 mb-1">
                                <Info size={12} className="text-primary/70" />
                                <span className="text-xs font-medium text-primary/90 font-mono">
                                  WAKU_LIGHT_STATUS
                                </span>
                              </div>
                              <div className="space-y-1 pl-4 border-l border-primary/10">
                                <p className="text-xs font-mono flex items-center justify-between">
                                  <span className="text-muted-foreground">
                                    STATUS:
                                  </span>{" "}
                                  <span
                                    className={`${
                                      isWakuConnected
                                        ? "text-green-500"
                                        : "text-amber-500"
                                    }`}
                                  >
                                    {isWakuConnecting
                                      ? "CONNECTING"
                                      : isWakuConnected
                                      ? "CONNECTED"
                                      : "DISCONNECTED"}
                                  </span>
                                </p>
                                {isWakuConnected && (
                                  <>
                                    <p className="text-xs font-mono flex items-center justify-between">
                                      <span className="text-muted-foreground">
                                        PEERS:
                                      </span>{" "}
                                      <span className="text-primary/80">
                                        {wakuPeerCount}
                                      </span>
                                    </p>
                                    <p className="text-xs font-mono flex items-center justify-between">
                                      <span className="text-muted-foreground">
                                        TOPIC:
                                      </span>{" "}
                                      <span
                                        className="text-primary/80 truncate max-w-[180px]"
                                        title={wakuContentTopic}
                                      >
                                        {wakuContentTopic}
                                      </span>
                                    </p>
                                  </>
                                )}
                                {wakuError && (
                                  <p className="text-xs font-mono flex items-center text-amber-500">
                                    <AlertCircle size={10} className="mr-1" />
                                    {wakuError}
                                  </p>
                                )}
                                {!isWakuConnected && !isWakuConnecting && (
                                  <Button
                                    variant="link"
                                    size="sm"
                                    className="text-xs p-0 h-auto font-mono text-primary"
                                    onClick={reconnectWaku}
                                  >
                                    Try Reconnect
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* TACo Settings */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-md bg-primary/10">
                              <Shield size={16} className="text-primary" />
                            </div>
                            <h3 className="text-base font-medium font-mono">
                              TACO_ENCRYPTION
                            </h3>
                          </div>
                          {walletConnected ? (
                            <div
                              className="w-2 h-2 rounded-full bg-green-500 animate-pulse"
                              title="Wallet connected"
                            ></div>
                          ) : (
                            <div
                              className="w-2 h-2 rounded-full bg-amber-600/80"
                              title="Wallet not connected"
                            ></div>
                          )}
                        </div>
                        <div className="space-y-4 pl-2 ml-2 border-l border-border">
                          {/* Wallet Connection */}
                          <div className="space-y-2">
                            <label className="text-sm font-medium font-mono">
                              WALLET_CONNECTION
                            </label>
                            <WalletConnectButton className="w-full" />
                            <p className="text-xs text-muted-foreground font-mono">
                              {walletConnected
                                ? "Wallet connected - TACo encryption available"
                                : "Connect your wallet to enable TACo encryption"}
                            </p>
                          </div>
                          {/* Encryption Toggle */}
                          <div className="space-y-2">
                            <label className="text-sm font-medium font-mono">
                              ENCRYPTION_STATUS
                            </label>
                            <div className="flex items-center space-x-2">
                              <Switch
                                id="encryption-toggle"
                                checked={useEncryption}
                                onCheckedChange={setUseEncryption}
                                disabled={!walletConnected}
                              />
                              <Label
                                htmlFor="encryption-toggle"
                                className="cursor-pointer"
                              >
                                {useEncryption ? (
                                  <div className="flex items-center gap-2 text-primary">
                                    <Lock className="h-4 w-4" />
                                    <span>Encryption Enabled</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 text-muted-foreground">
                                    <Unlock className="h-4 w-4" />
                                    <span>Encryption Disabled</span>
                                  </div>
                                )}
                              </Label>
                            </div>
                            <p className="text-xs text-muted-foreground font-mono">
                              Protect your shared files with TACo encryption
                            </p>
                          </div>
                          {/* Access Condition Settings (if encryption enabled) */}
                          {useEncryption && walletConnected && (
                            <div className="mt-3 p-2 bg-card/50 border border-primary/10 rounded-md">
                              <div className="flex items-center gap-1 mb-3">
                                <Shield size={12} className="text-primary/70" />
                                <span className="text-xs font-medium text-primary/90 font-mono">
                                  ACCESS_CONDITION
                                </span>
                              </div>
                              <div className="space-y-3 pl-4 border-l border-primary/10">
                                <div
                                  ref={useEncryptionInputRef}
                                  className="space-y-2"
                                >
                                  <RadioGroup
                                    value={accessConditionType}
                                    onValueChange={(val) =>
                                      setAccessConditionType(
                                        val as
                                          | "time"
                                          | "positive"
                                          | "amoyNFTUserSpecified"
                                      )
                                    }
                                    className="flex flex-col"
                                  >
                                    <div className="flex items-center space-x-2">
                                      <RadioGroupItem
                                        value="positive"
                                        id="positive"
                                      />
                                      <Label
                                        htmlFor="positive"
                                        className="text-xs font-mono"
                                      >
                                        POSITIVE_BALANCE
                                      </Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                      <RadioGroupItem value="time" id="time" />
                                      <Label
                                        htmlFor="time"
                                        className="text-xs font-mono"
                                      >
                                        TIME_WINDOW
                                      </Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                      <RadioGroupItem
                                        value="amoyNFTUserSpecified"
                                        id="amoyNFTUserSpecified"
                                      />
                                      <Label
                                        htmlFor="amoyNFTUserSpecified"
                                        className="text-xs font-mono"
                                      >
                                        ANY_AMOY_NFT (User Input)
                                      </Label>
                                    </div>
                                  </RadioGroup>
                                </div>
                                {accessConditionType === "time" && (
                                  <div ref={timeInputRef} className="space-y-1">
                                    <Label
                                      htmlFor="window-time"
                                      className="text-xs font-mono text-muted-foreground"
                                    >
                                      WINDOW_TIME_IN_SECONDS
                                    </Label>
                                    <Input
                                      id="window-time"
                                      placeholder="3600"
                                      value={windowTimeSeconds}
                                      onChange={(e) =>
                                        setWindowTimeSeconds(e.target.value)
                                      }
                                      className="font-mono text-sm bg-card/70"
                                    />
                                    <p className="text-xs text-muted-foreground font-mono">
                                      Access limited to specified time window in
                                      seconds
                                    </p>
                                  </div>
                                )}
                                {accessConditionType ===
                                  "amoyNFTUserSpecified" && (
                                  <div
                                    ref={nftContractAddressInputRef}
                                    className="space-y-1"
                                  >
                                    <Label
                                      htmlFor="nft-contract-address"
                                      className="text-xs font-mono text-muted-foreground"
                                    >
                                      AMOY_NFT_CONTRACT_ADDRESS
                                    </Label>
                                    <Input
                                      id="nft-contract-address"
                                      placeholder="0x..."
                                      value={nftContractAddress}
                                      onChange={(e) =>
                                        setNftContractAddress(e.target.value)
                                      }
                                      className="font-mono text-sm bg-card/70"
                                    />
                                    <p className="text-xs text-muted-foreground font-mono">
                                      Enter the ERC721 contract address on
                                      Polygon Amoy.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <SheetFooter className="mt-8 pt-4 border-t border-border flex gap-2 shrink-0">
                      <SheetClose asChild>
                        <Button variant="outline" className="flex-1 font-mono">
                          CANCEL
                        </Button>
                      </SheetClose>
                      <Button
                        className="flex-1 font-mono"
                        onClick={handleSaveConfig}
                        disabled={isSaving}
                      >
                        {isSaving ? (
                          <span className="flex items-center gap-2">
                            <span className="h-4 w-4 rounded-full border-2 border-t-transparent border-white animate-spin"></span>
                            SAVING...
                          </span>
                        ) : saveSuccess ? (
                          <span className="flex items-center gap-2">
                            <Check size={16} />
                            SAVED!
                          </span>
                        ) : (
                          "SAVE_CONFIG"
                        )}
                      </Button>
                    </SheetFooter>
                  </SheetContent>
                </Sheet>
              </div>
            </div>

            {/* Dropzone */}
            <div className="mt-8">
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all mb-4 bg-card shadow-sm relative overflow-hidden ${
                  isDragActive
                    ? "border-primary bg-accent scale-[0.99]"
                    : "border-border hover:border-primary/50 hover:bg-accent/50"
                }`}
              >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center justify-center gap-3 relative z-10">
                  <div
                    className={`p-4 rounded-full bg-accent transition-transform ${
                      isDragActive ? "scale-110" : ""
                    }`}
                  >
                    <Upload
                      size={36}
                      className={`transition-colors ${
                        isDragActive ? "text-primary" : "text-primary/70"
                      }`}
                    />
                  </div>
                  <h3 className="text-lg font-medium mt-2 font-mono">
                    {isDragActive
                      ? "Drop to share"
                      : "Drag and drop your files here"}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-2 font-mono">
                    or click to select files
                  </p>
                  <div className="px-4 py-1.5 rounded-full bg-muted text-xs text-muted-foreground font-mono border border-primary/10">
                    MAX_SIZE=100MB
                  </div>
                </div>
              </div>
            </div>

            {/* File Lists (Sent & Received) */}
            <Tabs defaultValue="sent" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4 font-mono">
                <TabsTrigger value="sent" className="flex items-center gap-2">
                  <Upload size={16} />
                  SENT_FILES
                </TabsTrigger>
                <TabsTrigger
                  value="received"
                  className="flex items-center gap-2"
                >
                  <Download size={16} />
                  RECEIVED_FILES
                </TabsTrigger>
              </TabsList>
              <TabsContent value="sent">
                <Card>
                  <CardContent className="p-6">
                    <div className="h-[250px] overflow-y-auto overflow-x-hidden space-y-4">
                      {Object.entries(uploadingFiles).length > 0 ||
                      sentFiles.length > 0 ? (
                        <div className="space-y-3">
                          {[
                            ...Object.entries(uploadingFiles).map(
                              ([fileId, file]) =>
                                ({
                                  id: fileId,
                                  name: file.name,
                                  size: file.size / (1024 * 1024),
                                  type: file.type,
                                  timestamp: new Date().toLocaleString(),
                                  fileId: undefined,
                                  isUploading: true,
                                  progress: file.progress,
                                  isEncrypted: file.isEncrypted,
                                  accessCondition: file.accessCondition,
                                } as FileItem)
                            ),
                            ...sentFiles,
                          ].map((file) => (
                            <div
                              key={file.id}
                              className="flex items-center justify-between p-3 bg-muted rounded-lg border border-border hover:border-primary/20 hover:bg-accent/50 transition-colors w-full"
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
                                <div
                                  className={`p-2 rounded-md bg-card text-primary shadow-sm border border-border flex-shrink-0 ${
                                    file.isUploading ? "animate-pulse" : ""
                                  }`}
                                >
                                  {getFileIcon(file.type)}
                                </div>
                                <div className="min-w-0 flex-1 overflow-hidden">
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium text-sm font-mono truncate">
                                      {file.name}
                                    </p>
                                    {file.isUploading && (
                                      <div className="flex items-center gap-1 text-xs text-primary animate-pulse">
                                        <span className="font-mono">
                                          {file.progress}%
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground font-mono truncate">
                                    {file.size.toFixed(2)} MB •{" "}
                                    {file.isUploading
                                      ? "Uploading..."
                                      : file.timestamp}
                                  </p>
                                  {file.isEncrypted && (
                                    <div className="flex items-center text-yellow-600 dark:text-yellow-500 mt-1 text-xs">
                                      <Lock className="h-3 w-3 mr-1" />
                                      <span>Encrypted</span>
                                      {file.accessCondition && (
                                        <Tooltip>
                                          <TooltipTrigger>
                                            <Info className="h-3 w-3 ml-1 cursor-help" />
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p className="text-xs">
                                              {file.accessCondition}
                                            </p>
                                          </TooltipContent>
                                        </Tooltip>
                                      )}
                                    </div>
                                  )}
                                  {file.isUploading && (
                                    <div className="w-full bg-muted rounded-full h-1 mt-2 overflow-hidden">
                                      <div
                                        className="bg-primary h-full transition-all duration-300 ease-in-out"
                                        style={{ width: `${file.progress}%` }}
                                      ></div>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                                {!file.isUploading && (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleCopyFileCid(file.id.toString())
                                      }
                                      className="h-8 w-8 p-0 hover:bg-primary/20 hover:text-primary text-accent-foreground border border-primary/20 transition-all relative group"
                                      disabled={!file.fileId}
                                      title={
                                        file.fileId
                                          ? "Copy file CID"
                                          : "No CID available"
                                      }
                                    >
                                      {copiedFileCid === file.id.toString() ? (
                                        <Check
                                          size={14}
                                          className="text-green-500"
                                        />
                                      ) : (
                                        <Copy size={14} />
                                      )}
                                      <span className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-black/80 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none">
                                        Copy CID
                                      </span>
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleDownloadFile(file.id.toString())
                                      }
                                      className="h-8 w-8 p-0 hover:bg-primary/20 hover:text-primary text-accent-foreground border border-primary/20 transition-all relative group"
                                      disabled={!file.fileId}
                                      title={
                                        file.fileId
                                          ? "Download file"
                                          : "No file available for download"
                                      }
                                    >
                                      <Download size={14} />
                                      <span className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-black/80 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none">
                                        Download File
                                      </span>
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full">
                          <div className="p-3 rounded-full bg-muted/50">
                            <Upload
                              size={24}
                              className="text-muted-foreground/60"
                            />
                          </div>
                          <p className="text-muted-foreground font-mono mt-3">
                            No files sent yet
                          </p>
                          <p className="text-xs text-muted-foreground/70 font-mono mt-1">
                            Upload files to see them here
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="received">
                <Card className="shadow-sm border-border relative overflow-hidden">
                  <CardHeader className="pb-3 border-b border-border bg-card">
                    <CardTitle className="text-lg font-mono">
                      Files Received
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 bg-card">
                    <div className="h-[250px] overflow-y-auto overflow-x-hidden p-4 relative">
                      {receivedFiles.length > 0 ? (
                        <div className="space-y-3">
                          {receivedFiles.map((file) => (
                            <div
                              key={file.id}
                              className="flex items-center justify-between p-3 bg-muted rounded-lg border border-border hover:border-primary/20 hover:bg-accent/50 transition-colors w-full"
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
                                <div className="p-2 rounded-md bg-card text-primary shadow-sm border border-border flex-shrink-0">
                                  {getFileIcon(file.type)}
                                </div>
                                <div className="min-w-0 flex-1 overflow-hidden">
                                  <p className="font-medium text-sm font-mono truncate">
                                    {file.name}
                                    {file.isEncrypted && (
                                      <Tooltip>
                                        <TooltipTrigger>
                                          {" "}
                                          <Lock
                                            size={14}
                                            className="ml-1 inline-block text-yellow-500"
                                          />{" "}
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p className="text-xs">
                                            {file.accessCondition ||
                                              "Encrypted file"}
                                          </p>
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                  </p>
                                  <p className="text-xs text-muted-foreground font-mono truncate">
                                    {file.size.toFixed(2)} MB • {file.timestamp}
                                  </p>
                                  {file.fileId && (
                                    <p
                                      className="text-xs text-primary/70 font-mono truncate"
                                      title={file.fileId}
                                    >
                                      CID: {file.fileId.substring(0, 8)}...
                                      {file.fileId.substring(
                                        file.fileId.length - 6
                                      )}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                                {(file.name.endsWith(".py") ||
                                  file.type.includes("python")) && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      handleViewPyFile(file.id.toString())
                                    }
                                    className="h-8 w-8 p-0 hover:bg-primary/20 hover:text-primary text-accent-foreground border border-primary/20 transition-all relative group"
                                    title="View & Run Python file"
                                    disabled={
                                      !file.fileId ||
                                      decryptionInProgress[file.fileId!]
                                    }
                                  >
                                    <Eye size={14} />
                                    <span className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-black/80 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none">
                                      View/Run
                                    </span>
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleCopyFileCid(file.id.toString())
                                  }
                                  className="h-8 w-8 p-0 hover:bg-primary/20 hover:text-primary text-accent-foreground border border-primary/20 transition-all relative group"
                                  disabled={!file.fileId}
                                  title={
                                    file.fileId
                                      ? "Copy file CID"
                                      : "No CID available"
                                  }
                                >
                                  {copiedFileCid === file.id.toString() ? (
                                    <Check
                                      size={14}
                                      className="text-green-500"
                                    />
                                  ) : (
                                    <Copy size={14} />
                                  )}
                                  <span className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-black/80 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none">
                                    Copy CID
                                  </span>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleDownloadFile(file.id.toString())
                                  }
                                  className="h-8 w-8 p-0 hover:bg-primary/20 hover:text-primary text-accent-foreground border border-primary/20 transition-all relative group"
                                  disabled={
                                    !file.fileId ||
                                    decryptionInProgress[file.fileId!]
                                  }
                                  title={
                                    file.fileId
                                      ? "Download file"
                                      : "No file available for download"
                                  }
                                >
                                  {decryptionInProgress[file.fileId!] ? (
                                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-t-transparent border-primary"></div>
                                  ) : (
                                    <Download size={14} />
                                  )}
                                  <span className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-black/80 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none">
                                    Download File
                                  </span>
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full">
                          <div className="p-3 rounded-full bg-muted/50">
                            <Download
                              size={24}
                              className="text-muted-foreground/60"
                            />
                          </div>
                          <p className="text-muted-foreground font-mono mt-3">
                            No files received yet
                          </p>
                          <p className="text-xs text-muted-foreground/70 font-mono mt-1">
                            Received files will appear here
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                  <div className="absolute inset-0 pointer-events-none opacity-10 bg-scanline"></div>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </main>

        {/* Node Info display */}
        <footer className="p-4 md:p-8 pt-0">
          <div className="w-full max-w-5xl mx-auto">{renderNodeInfo()}</div>
        </footer>

        <style jsx global>{`
          .terminal-display {
            font-family: var(--font-mono);
            letter-spacing: 0.5px;
          }
          .terminal-glow {
            box-shadow: 0 0 10px rgba(6, 243, 145, 0.3);
          }
          /* Enhanced cathode effects from globals.css are already applied via body styles */
        `}</style>
      </div>
    </TooltipProvider>
  );
}
