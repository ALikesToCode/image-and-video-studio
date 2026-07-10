"use client";

import * as React from "react";

import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/app/components/ui/select";
import type {
    ModelOption,
    ModelParameterDescriptor,
    ModelParameterValue,
} from "@/lib/constants";
import {
    isModelParameterVisible,
    type ModelParameterValues,
} from "@/lib/model-capability-settings";

interface ModelParameterSettingsProps {
    model?: ModelOption;
    values: ModelParameterValues;
    onValueChange: (key: string, value: ModelParameterValue) => void;
}

const formatParameterLabel = (key: string) =>
    key
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/^./, (character) => character.toUpperCase());

const parameterLabel = (key: string, descriptor: ModelParameterDescriptor) =>
    descriptor.label?.trim() || formatParameterLabel(key);

export function ModelParameterSettings({
    model,
    values,
    onValueChange,
}: ModelParameterSettingsProps) {
    const componentId = React.useId();
    const parameters = Object.entries(model?.dynamicParameters ?? {}).filter(
        ([, descriptor]) => isModelParameterVisible(descriptor, values)
    );

    if (parameters.length === 0) return null;

    return (
        <div className="space-y-4">
            {parameters.map(([key, descriptor], index) => {
                const fieldId = `${componentId}-parameter-${index}`;
                const descriptionId = descriptor.description
                    ? `${fieldId}-description`
                    : undefined;
                const label = parameterLabel(key, descriptor);

                if (descriptor.type === "switch" || descriptor.type === "boolean") {
                    return (
                        <div
                            key={key}
                            className="flex items-start justify-between gap-4"
                            data-model-parameter-key={key}
                        >
                            <div className="space-y-1">
                                <Label htmlFor={fieldId} className="cursor-pointer">
                                    {label}
                                </Label>
                                {descriptor.description ? (
                                    <p
                                        id={descriptionId}
                                        className="text-xs leading-relaxed text-muted-foreground"
                                    >
                                        {descriptor.description}
                                    </p>
                                ) : null}
                            </div>
                            <input
                                id={fieldId}
                                type="checkbox"
                                role={descriptor.type === "switch" ? "switch" : undefined}
                                checked={values[key] === true}
                                onChange={(event) => onValueChange(key, event.currentTarget.checked)}
                                aria-describedby={descriptionId}
                                className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-primary focus:ring-primary"
                            />
                        </div>
                    );
                }

                if (descriptor.type === "select") {
                    const options = descriptor.options ?? [];
                    const selectedOptionIndex = options.findIndex((option) =>
                        Object.is(option.value, values[key])
                    );

                    return (
                        <div
                            key={key}
                            className="space-y-2"
                            data-model-parameter-key={key}
                        >
                            <Label htmlFor={fieldId}>{label}</Label>
                            <Select
                                value={selectedOptionIndex >= 0 ? String(selectedOptionIndex) : ""}
                                onValueChange={(optionIndex) => {
                                    const option = options[Number(optionIndex)];
                                    if (option) onValueChange(key, option.value);
                                }}
                                disabled={options.length === 0}
                            >
                                <SelectTrigger id={fieldId} aria-describedby={descriptionId}>
                                    <SelectValue
                                        placeholder={
                                            descriptor.placeholder ??
                                            (options.length > 0
                                                ? `Select ${label.toLowerCase()}`
                                                : "No options available")
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    {options.map((option, optionIndex) => (
                                        <SelectItem
                                            key={`${optionIndex}-${String(option.value)}`}
                                            value={String(optionIndex)}
                                        >
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {descriptor.description ? (
                                <p
                                    id={descriptionId}
                                    className="text-xs leading-relaxed text-muted-foreground"
                                >
                                    {descriptor.description}
                                </p>
                            ) : null}
                        </div>
                    );
                }

                const value = values[key];
                const isNumber = descriptor.type === "number";

                return (
                    <div
                        key={key}
                        className="space-y-2"
                        data-model-parameter-key={key}
                    >
                        <Label htmlFor={fieldId}>{label}</Label>
                        <Input
                            id={fieldId}
                            type={isNumber ? "number" : "text"}
                            value={
                                isNumber
                                    ? typeof value === "number" && Number.isFinite(value)
                                        ? String(value)
                                        : ""
                                    : typeof value === "string"
                                      ? value
                                      : ""
                            }
                            min={isNumber ? descriptor.min : undefined}
                            max={isNumber ? descriptor.max : undefined}
                            step={isNumber ? descriptor.step : undefined}
                            placeholder={descriptor.placeholder}
                            aria-describedby={descriptionId}
                            onChange={(event) => {
                                if (!isNumber) {
                                    onValueChange(key, event.currentTarget.value);
                                    return;
                                }

                                const nextValue = event.currentTarget.valueAsNumber;
                                onValueChange(
                                    key,
                                    Number.isFinite(nextValue) ? nextValue : null
                                );
                            }}
                        />
                        {descriptor.description ? (
                            <p
                                id={descriptionId}
                                className="text-xs leading-relaxed text-muted-foreground"
                            >
                                {descriptor.description}
                            </p>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

export type { ModelParameterSettingsProps };
