"use client";

import { useEffect, useRef } from "react";

import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

interface EditorPaneProps {
  doc: Y.Doc;
  awareness: Awareness;
  language: string;
}

type MonacoBindingType = typeof import("y-monaco").MonacoBinding;

export function EditorPane({ doc, awareness, language }: EditorPaneProps) {
  const bindingRef = useRef<InstanceType<MonacoBindingType> | null>(null);

  useEffect(() => {
    return () => {
      bindingRef.current?.destroy();
    };
  }, []);

  async function handleMount(
    instance: editor.IStandaloneCodeEditor,
    monaco: Monaco,
  ): Promise<void> {
    const { MonacoBinding } = await import("y-monaco");
    const model =
      instance.getModel() ??
      monaco.editor.createModel(doc.getText("monaco").toString(), language);

    instance.setModel(model);
    bindingRef.current?.destroy();
    bindingRef.current = new MonacoBinding(
      doc.getText("monaco"),
      model,
      new Set([instance]),
      awareness,
    );
  }

  return (
    <Editor
      height="100%"
      defaultLanguage={language}
      defaultValue=""
      theme="vs"
      onMount={(instance, monaco) => {
        void handleMount(instance, monaco);
      }}
      options={{
        fontSize: 14,
        minimap: { enabled: false },
        padding: { top: 16 },
        smoothScrolling: true,
        scrollBeyondLastLine: false,
        wordWrap: "on",
      }}
    />
  );
}
