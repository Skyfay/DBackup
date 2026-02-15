"use client";

import { useFormContext } from "react-hook-form";
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { TagInput } from "@/components/ui/tag-input";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email tag input field for the notification adapter form.
 * Renders a TagInput that allows adding/removing multiple recipient emails.
 */
export function EmailTagField() {
    const { control } = useFormContext();

    return (
        <FormField
            control={control}
            name="config.to"
            render={({ field }) => {
                // Normalize value to array (backward compat with stored string)
                const tags: string[] = Array.isArray(field.value)
                    ? field.value
                    : field.value
                        ? [field.value]
                        : [];

                return (
                    <FormItem>
                        <FormLabel>To</FormLabel>
                        <FormControl>
                            <TagInput
                                value={tags}
                                onChange={field.onChange}
                                placeholder="recipient@example.com"
                                validate={(email) => EMAIL_REGEX.test(email)}
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                );
            }}
        />
    );
}
