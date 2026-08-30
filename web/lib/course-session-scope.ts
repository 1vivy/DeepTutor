/** Wire-level course scope shared by the standalone study surfaces. */

export function courseSessionConfiguration<T extends object>(
  configuration: T,
  courseId: string,
): T | (T & { courseId: string }) {
  const cleanCourseId = courseId.trim();
  return cleanCourseId
    ? { ...configuration, courseId: cleanCourseId }
    : configuration;
}

export function courseTurnConfiguration(
  configuration: Record<string, unknown> | undefined,
  courseId: string,
): Record<string, unknown> {
  return { ...(configuration || {}), _course_id: courseId.trim() };
}
