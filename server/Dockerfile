# Bygger servern för samma arkitektur som NAS:en (x64 eller arm64).
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
ARG TARGETARCH
WORKDIR /src
COPY Matpref.Server/Matpref.Server.csproj Matpref.Server/
RUN dotnet restore Matpref.Server -a $TARGETARCH
COPY Matpref.Server/ Matpref.Server/
RUN dotnet publish Matpref.Server -a $TARGETARCH --no-restore -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine
WORKDIR /app
COPY --from=build /app .
# Databasen ligger i /data, montera en volym där så att den överlever uppdateringar.
RUN mkdir /data && chown $APP_UID /data
VOLUME /data
USER $APP_UID
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
HEALTHCHECK --interval=5m --timeout=5s CMD wget -qO- http://localhost:8080/api/health || exit 1
ENTRYPOINT ["dotnet", "Matpref.Server.dll"]
