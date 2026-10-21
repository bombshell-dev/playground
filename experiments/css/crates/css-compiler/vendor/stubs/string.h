#ifndef STRING_H
#define STRING_H
void *memcpy(void *, const void *, unsigned long);
void *memmove(void *, const void *, unsigned long);
void *memset(void *, int, unsigned long);
int memcmp(const void *, const void *, unsigned long);
unsigned long strlen(const char *);
int strcmp(const char *, const char *);
int strncmp(const char *, const char *, unsigned long);
char *strchr(const char *, int);
void *memchr(const void *, int, unsigned long);
char *strcpy(char *, const char *);
char *strncpy(char *, const char *, unsigned long);
#endif
