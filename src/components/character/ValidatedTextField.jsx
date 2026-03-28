import React from "react";
import { motion } from "framer-motion";
import { AlertCircle, Check } from "lucide-react";

// Field-specific character limits
const FIELD_LIMITS = {
  background_story: 2000,
  personality_override: 1500,
  situation_override: 1500,
  occupation_description: 800,
  criminal_record: 1000,
  work_environment: 600,
};

export default function ValidatedTextField({
  fieldName,
  value = "",
  onChange,
  placeholder,
  label,
  helpText,
  generateButton,
  minHeight = "70px",
  isGenerating = false,
}) {
  const maxLength = FIELD_LIMITS[fieldName] || null;
  const charCount = value ? value.length : 0;
  const isOverLimit = maxLength && charCount > maxLength;
  const isNearLimit = maxLength && charCount > maxLength * 0.8;
  const remainingChars = maxLength ? maxLength - charCount : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-muted-foreground uppercase tracking-wider">
          {label}
        </label>
        {generateButton}
      </div>

      {helpText && (
        <p className="text-xs text-muted-foreground mb-2">{helpText}</p>
      )}

      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full rounded-xl text-sm resize-none outline-none px-4 py-3 transition-all ${
            isOverLimit
              ? "bg-destructive/10 text-destructive border-2 border-destructive"
              : isNearLimit
              ? "bg-amber-500/10 text-foreground border-2 border-amber-500/50"
              : "bg-background border border-border text-foreground"
          }`}
          style={{
            minHeight,
            backgroundColor: isOverLimit
              ? "rgb(239, 68, 68, 0.1)"
              : isNearLimit
              ? "rgb(217, 119, 6, 0.1)"
              : "",
          }}
        />
      </div>

      {/* Counter + validation message */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2">
          {maxLength && (
            <>
              <span
                className={`text-xs font-medium ${
                  isOverLimit
                    ? "text-destructive"
                    : isNearLimit
                    ? "text-amber-600"
                    : "text-muted-foreground"
                }`}
              >
                {charCount} / {maxLength} characters
              </span>
              {isOverLimit && (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="flex items-center gap-1 text-xs text-destructive font-medium"
                >
                  <AlertCircle className="w-3 h-3" />
                  Too long
                </motion.div>
              )}
              {isNearLimit && !isOverLimit && (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="flex items-center gap-1 text-xs text-amber-600 font-medium"
                >
                  {remainingChars} characters left
                </motion.div>
              )}
              {!isNearLimit && maxLength && (
                <span className="text-xs text-muted-foreground/60">
                  ({remainingChars} remaining)
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {isOverLimit && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/30"
        >
          <p className="text-xs text-destructive font-medium">
            This field exceeds the {maxLength} character limit. Please shorten it
            before creating the character.
          </p>
        </motion.div>
      )}
    </div>
  );
}